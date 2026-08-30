import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agents, calls, contacts, transcripts } from "@db/schema";
import { getCredentialsForUser, requireTwilio } from "./credentialsRouter";
import { twilioCreateCall } from "./services/twilio";

const E164 = /^\+[1-9]\d{7,14}$/;

function baseUrl() {
  // Public URL of this deployment — used for Twilio webhook callbacks.
  const b = process.env.PUBLIC_BASE_URL || process.env.VITE_APP_URL || "";
  if (!b) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "PUBLIC_BASE_URL is not configured on the server.",
    });
  }
  return b.replace(/\/$/, "");
}

export const callsRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb().query.calls.findMany({
      where: eq(calls.userId, ctx.user.id),
      orderBy: [desc(calls.createdAt)],
      limit: 100,
    });
  }),

  transcript: authedQuery
    .input(z.object({ callId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const call = await db.query.calls.findFirst({
        where: and(eq(calls.id, input.callId), eq(calls.userId, ctx.user.id)),
      });
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });
      const lines = await db.query.transcripts.findMany({
        where: eq(transcripts.callId, call.id),
        orderBy: [transcripts.createdAt],
      });
      return { call, lines };
    }),

  placeCall: authedQuery
    .input(
      z.object({
        agentId: z.number(),
        to: z.string().regex(E164, "Phone must be E.164, e.g. +15551234567"),
        leadName: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // DNC enforcement — hard block
      const contact = await db.query.contacts.findFirst({
        where: and(eq(contacts.userId, ctx.user.id), eq(contacts.phone, input.to)),
      });
      if (contact?.dnc) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This number is on your Do-Not-Call list." });
      }

      const agent = await db.query.agents.findFirst({
        where: and(eq(agents.id, input.agentId), eq(agents.userId, ctx.user.id)),
      });
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      if (agent.direction === "inbound") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This agent is inbound-only." });
      }

      const twilio = requireTwilio(await getCredentialsForUser(ctx.user.id));
      const base = baseUrl();

      const result = await twilioCreateCall(twilio, {
        to: input.to,
        twimlUrl: `${base}/api/webhooks/twilio/voice/${agent.id}${input.leadName ? `?lead_name=${encodeURIComponent(input.leadName)}` : ""}`,
        statusCallbackUrl: `${base}/api/webhooks/twilio/status`,
      });

      const ins = await db.insert(calls).values({
        userId: ctx.user.id,
        agentId: agent.id,
        callSid: result.sid,
        direction: "outbound",
        toNumber: input.to,
        fromNumber: twilio.phoneNumber,
        status: result.status || "queued",
      });

      return { callId: Number(ins[0].insertId), callSid: result.sid, status: result.status };
    }),

  stats: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const uid = ctx.user.id;
    const [totals] = await db
      .select({
        totalCalls: sql<number>`COUNT(*)`,
        activeCalls: sql<number>`SUM(CASE WHEN ${calls.status} IN ('initiated','queued','ringing','in-progress','answered') THEN 1 ELSE 0 END)`,
        avgDuration: sql<number>`COALESCE(AVG(${calls.duration}), 0)`,
      })
      .from(calls)
      .where(eq(calls.userId, uid));
    const [agentCount] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(agents)
      .where(eq(agents.userId, uid));
    const [contactCount] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(contacts)
      .where(eq(contacts.userId, uid));
    const recentCalls = await db.query.calls.findMany({
      where: eq(calls.userId, uid),
      orderBy: [desc(calls.createdAt)],
      limit: 5,
    });
    return {
      totalCalls: Number(totals?.totalCalls ?? 0),
      activeCalls: Number(totals?.activeCalls ?? 0),
      avgDuration: Math.round(Number(totals?.avgDuration ?? 0)),
      agents: Number(agentCount?.n ?? 0),
      contacts: Number(contactCount?.n ?? 0),
      recentCalls,
    };
  }),
});

// referenced by webhooks
export { baseUrl };
