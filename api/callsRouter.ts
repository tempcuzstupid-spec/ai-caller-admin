// Calls router — multi-tenant aware + FastAPI-bridged.
//
// Every call is scoped to a tenant (via ctx.tenant.id). The user may belong
// to multiple tenants in the future; for now, the user's default tenant is
// the only one we read from.
//
// DNC enforcement happens at the API layer (not the prompt layer). This is
// the enterprise-grade answer to "we have a Do-Not-Call list."
//
// Call placement goes through the FastAPI backend (the Python service
// running on Render). The admin doesn't talk to Twilio directly. This
// centralizes the Twilio creds in FastAPI and makes the admin a control
// panel. The FastAPI service creates the call record; the admin mirrors
// a reference to it in admin_calls for the dashboard.

import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentConfigs, calls, contacts, transcripts, auditLog } from "@db/schema";
import { getCredentialsForTenant } from "./credentialsRouter";
import { callFastApiJson } from "./lib/fastapi";

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
        leadEmail: z.string().email().optional(),
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

      // ── Bridge to FastAPI backend ─────────────────────────────────
      // The FastAPI service is the source of truth for call placement.
      // It owns the Twilio creds and the WebSocket gateway.
      const cred = await getCredentialsForTenant(tenantId);
      if (!cred?.fastApiUrl || !cred?.fastApiAdminKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "FastAPI backend is not configured for this tenant. Add FastAPI URL + admin key in Settings.",
        });
      }

      // Map the agent_config's vertical to a FastAPI "purpose" enum.
      // FastAPI accepts: general, sales_demo, support, reminder,
      //   personal_assistant, lead_qualification, sales_close, appointment
      // The admin has more verticals than FastAPI's purpose enum, so we
      // collapse them. The agent's name + system prompt carry the rest.
      const verticalCategory = agentConfig.vertical?.category;
      let purpose:
        | "general"
        | "sales_demo"
        | "support"
        | "reminder"
        | "personal_assistant"
        | "lead_qualification"
        | "sales_close"
        | "appointment";
      if (verticalCategory === "appointment_reminder") {
        purpose = "appointment";
      } else if (verticalCategory === "b2b_saas") {
        purpose = "lead_qualification";
      } else if (verticalCategory === "personal_assistant") {
        purpose = "personal_assistant";
      } else if (verticalCategory === "legal_intake") {
        purpose = "lead_qualification";
      } else {
        // peptides_wellness, dental_practice, real_estate, home_services,
        // hospitality, custom, inbound_support (shouldn't reach here)
        purpose = "sales_demo";
      }

      const fastApiRes = await callFastApiJson<{
        call_sid: string;
        status: string;
        to: string;
        from: string;
        call_id?: string;
      }>({ url: cred.fastApiUrl, adminKey: cred.fastApiAdminKey }, "/call", {
        method: "POST",
        body: JSON.stringify({
          to: input.to,
          purpose,
          lead_name: input.leadName,
          lead_context: input.leadContext,
        }),
      });

      // ── Mirror the call in admin_calls for the dashboard ─────────
      // FastAPI already created the call in its own (legacy `calls`)
      // table. We mirror a reference here so the admin's call list
      // can show "calls placed via this admin." The callSid is the join key.
      const phiClassification = agentConfig.complianceTier === "hipaa" ? "phi" : "pii";
      const inserted = await db
        .insert(calls)
        .values({
          tenantId,
          agentConfigId: agentConfig.id,
          callSid: fastApiRes.call_sid,
          direction: "outbound",
          toNumber: input.to,
          fromNumber: fastApiRes.from ?? "",
          status: (fastApiRes.status ?? "queued") as any,
          leadName: input.leadName,
          leadContext: input.leadContext,
          phiClassification,
        })
        .onConflictDoNothing({ target: calls.callSid })
        .returning({ id: calls.id });

      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "create",
        resourceType: "call",
        resourceId: fastApiRes.call_sid,
        details: {
          to: input.to,
          leadName: input.leadName,
          agentConfigId: agentConfig.id,
          vertical: agentConfig.vertical?.category,
          bridgedVia: "fastapi",
          fastApiCallId: fastApiRes.call_id,
        },
      });

      return {
        callId: inserted[0]?.id ?? 0,
        callSid: fastApiRes.call_sid,
        status: fastApiRes.status,
        from: fastApiRes.from,
      };
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
