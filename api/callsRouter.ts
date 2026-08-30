// Calls router — multi-tenant aware.
//
// Every call is scoped to a tenant (via ctx.tenant.id). The user may belong
// to multiple tenants in the future; for now, the user's default tenant is
// the only one we read from.
//
// DNC enforcement happens at the API layer (not the prompt layer). This is
// the enterprise-grade answer to "we have a Do-Not-Call list."

import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentConfigs, calls, contacts, transcripts, auditLog } from "@db/schema";
import { getCredentialsForTenant, requireTwilio } from "./credentialsRouter";
import { twilioCreateCall } from "./services/twilio";

const E164 = /^\+[1-9]\d{7,14}$/;

function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

function baseUrl() {
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
    const tenantId = requireTenantId(ctx);
    return getDb().query.calls.findMany({
      where: eq(calls.tenantId, tenantId),
      orderBy: [desc(calls.createdAt)],
      limit: 100,
    });
  }),

  transcript: authedQuery
    .input(z.object({ callId: z.number() }))
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const call = await db.query.calls.findFirst({
        where: and(eq(calls.id, input.callId), eq(calls.tenantId, tenantId)),
      });
      if (!call) throw new TRPCError({ code: "NOT_FOUND" });

      // Audit every transcript read (HIPAA-aware: every PHI read is logged)
      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        actorType: "user",
        action: "read",
        resourceType: "transcript",
        resourceId: String(call.id),
        details: { callSid: call.callSid },
      });

      const lines = await db.query.transcripts.findMany({
        where: eq(transcripts.callId, call.id),
        orderBy: [transcripts.createdAt],
      });
      return { call, lines };
    }),

  placeCall: authedQuery
    .input(
      z.object({
        agentConfigId: z.number(),
        to: z.string().regex(E164, "Phone must be E.164, e.g. +15551234567"),
        leadName: z.string().max(120).optional(),
        leadContext: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      // ── DNC enforcement (API layer, not prompt layer) ────────────
      const contact = await db.query.contacts.findFirst({
        where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, input.to)),
      });
      if (contact?.dnc) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This number is on the Do-Not-Call list for this tenant.",
        });
      }

      // ── Verify agent config exists, is outbound-capable, and belongs to this tenant ──
      const agentConfig = await db.query.agentConfigs.findFirst({
        where: and(eq(agentConfigs.id, input.agentConfigId), eq(agentConfigs.tenantId, tenantId)),
        with: { vertical: true },
      });
      if (!agentConfig) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      }
      if (agentConfig.vertical?.direction === "inbound") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This agent is inbound-only." });
      }
      if (!agentConfig.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This agent is not active." });
      }

      const twilio = requireTwilio(await getCredentialsForTenant(tenantId));
      const base = baseUrl();

      const result = await twilioCreateCall(twilio, {
        to: input.to,
        twimlUrl: `${base}/api/webhooks/twilio/voice/${agentConfig.id}${input.leadName ? `?lead_name=${encodeURIComponent(input.leadName)}` : ""}`,
        statusCallbackUrl: `${base}/api/webhooks/twilio/status`,
      });

      // Determine phi_classification from agent's compliance_tier
      const phiClassification = agentConfig.complianceTier === "hipaa" ? "phi" : "pii";

      const inserted = await db
        .insert(calls)
        .values({
          tenantId,
          agentConfigId: agentConfig.id,
          callSid: result.sid,
          direction: "outbound",
          toNumber: input.to,
          fromNumber: twilio.phoneNumber,
          status: result.status || "queued",
          leadName: input.leadName,
          leadContext: input.leadContext,
          phiClassification,
        })
        .returning({ id: calls.id });

      // Audit the call placement
      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "create",
        resourceType: "call",
        resourceId: String(inserted[0].id),
        details: {
          to: input.to,
          leadName: input.leadName,
          agentConfigId: agentConfig.id,
          vertical: agentConfig.vertical?.category,
        },
      });

      return { callId: inserted[0].id, callSid: result.sid, status: result.status };
    }),

  stats: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    const db = getDb();
    const [totals] = await db
      .select({
        totalCalls: sql<number>`COUNT(*)`,
        activeCalls: sql<number>`SUM(CASE WHEN ${calls.status} IN ('initiated','queued','ringing','in_progress','answered') THEN 1 ELSE 0 END)`,
        avgDuration: sql<number>`COALESCE(AVG(${calls.duration}), 0)`,
        totalCostCents: sql<number>`COALESCE(SUM(${calls.costTwilioCents} + ${calls.costDeepgramCents} + ${calls.costOpenaiCents} + ${calls.costElevenlabsCents}), 0)`,
      })
      .from(calls)
      .where(eq(calls.tenantId, tenantId));
    const [agentCount] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, tenantId));
    const [contactCount] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(contacts)
      .where(eq(contacts.tenantId, tenantId));
    const recentCalls = await db.query.calls.findMany({
      where: eq(calls.tenantId, tenantId),
      orderBy: [desc(calls.createdAt)],
      limit: 5,
    });
    return {
      totalCalls: Number(totals?.totalCalls ?? 0),
      activeCalls: Number(totals?.activeCalls ?? 0),
      avgDuration: Math.round(Number(totals?.avgDuration ?? 0)),
      agents: Number(agentCount?.n ?? 0),
      contacts: Number(contactCount?.n ?? 0),
      totalCostCents: Number(totals?.totalCostCents ?? 0),
      recentCalls,
    };
  }),
});

// referenced by webhooks
export { baseUrl };
