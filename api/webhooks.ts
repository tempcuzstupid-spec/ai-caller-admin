// Raw Twilio webhook endpoints (form-encoded, XML responses) — mounted on Hono.
// Multi-tenant aware: every lookup is scoped to the tenant that owns the agent
// or the call. Tenant context is derived from the agent or call record, not
// from the URL path.

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { agentConfigs, calls, transcripts, verticals } from "@db/schema";
import { buildConversationRelayTwiML } from "./services/twilio";
import { getCredentialsForTenant } from "./credentialsRouter";

export const webhooks = new Hono();

function baseUrl(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.VITE_APP_URL || "";
  if (configured) return configured.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

// ── Number → tenant resolver ────────────────────────────────────────────
// In a single-tenant model, the agentConfig ID is in the URL. In the
// multi-tenant model, the agentConfig ID is still the URL parameter, and
// we look up the tenant from the agentConfig row. That way the same Twilio
// webhook URL serves all tenants — each one just maps to a different
// agentConfig ID.
//
// Inbound calls need a different path: Twilio's number → tenant lookup
// happens via the `From` number matching a tenant's twilioPhoneNumber.
// For now, this is single-tenant-flow (the path includes agentConfigId).

webhooks.post("/twilio/voice/:agentConfigId", async (c) => {
  const agentConfigId = Number(c.req.param("agentConfigId"));
  if (!Number.isFinite(agentConfigId)) return c.text("Bad agent", 400);
  const db = getDb();

  const agentConfig = await db.query.agentConfigs.findFirst({
    where: eq(agentConfigs.id, agentConfigId),
    with: { vertical: true },
  });
  if (!agentConfig || !agentConfig.active) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This line is not configured. Goodbye.</Say></Response>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }

  const cred = await getCredentialsForTenant(agentConfig.tenantId);
  const wsUrl = cred?.wsGatewayUrl || process.env.DEFAULT_WS_GATEWAY_URL || "";
  if (!wsUrl) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>The voice gateway is not configured. Goodbye.</Say></Response>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }

  const leadName = c.req.query("lead_name") || null;
  // Determine opening line: tenant override → vertical default → null
  const openingLine =
    agentConfig.vertical?.direction === "outbound"
      ? agentConfig.openingLineOverride ?? null
      : null;

  const twiml = buildConversationRelayTwiML({
    wsUrl,
    token: cred?.conversationWsToken,
    agentId: agentConfig.id,
    openingLine,
    voiceId: agentConfig.voiceId,
    leadName,
    actionUrl: `${baseUrl(c.req.raw)}/api/webhooks/twilio/action/${agentConfig.id}`,
  });

  // Record inbound calls (outbound calls are recorded at placement time)
  const form = await c.req.parseBody().catch(() => ({} as any));
  const callSid = (form as any).CallSid as string | undefined;
  if (callSid && agentConfig.vertical?.direction !== "outbound") {
    const phiClassification = agentConfig.complianceTier === "hipaa" ? "phi" : "pii";
    await db
      .insert(calls)
      .values({
        tenantId: agentConfig.tenantId,
        agentConfigId: agentConfig.id,
        callSid,
        direction: "inbound",
        toNumber: ((form as any).To as string) || "",
        fromNumber: ((form as any).From as string) || "",
        status: "in_progress",
        phiClassification,
      })
      .onConflictDoUpdate({
        target: calls.callSid,
        set: { status: "in_progress" },
      });
  }

  return c.text(twiml, 200, { "Content-Type": "application/xml" });
});

// ConversationRelay ended (or call ended) — Twilio posts here.
webhooks.post("/twilio/action/:agentConfigId", async (c) => {
  const form = (await c.req.parseBody().catch(() => ({}))) as any;
  const callSid = form.CallSid as string | undefined;
  let handoff: any = null;
  if (form.HandoffData) {
    try { handoff = JSON.parse(form.HandoffData); } catch { /* ignore */ }
  }
  if (callSid) {
    const db = getDb();
    // Handoff to a human agent: only if reasonCode == "live-agent-handoff"
    // (per the locked ConversationRelay warm-transfer pattern in memory)
    const reasonCode = handoff?.reasonCode;
    if (reasonCode === "live-agent-handoff" && handoff?.lead_name) {
      // The agent's handoff_number is on the agentConfig. Look up call → agent → handoff.
      const call = await db.query.calls.findFirst({
        where: eq(calls.callSid, callSid),
        with: { agentConfig: true },
      });
      if (call?.agentConfig?.handoffNumber) {
        // Return TwiML to dial the human. Lead context goes via <Dial> <Sip>
        // headers (not used here) or simply by Twilio's display.
        return c.text(
          `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to a specialist now. One moment please.</Say>
  <Dial answerOnBridge="true">${call.agentConfig.handoffNumber}</Dial>
</Response>`,
          200,
          { "Content-Type": "application/xml" },
        );
      }
    }

    // Otherwise: normal end.
    await db
      .update(calls)
      .set({ status: "completed", endedAt: new Date(), outcome: reasonCode || "completed" })
      .where(eq(calls.callSid, callSid));
  }
  return c.text(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. Goodbye.</Say></Response>`,
    200,
    { "Content-Type": "application/xml" },
  );
});

// Twilio status callbacks (call lifecycle)
webhooks.post("/twilio/status", async (c) => {
  const form = (await c.req.parseBody().catch(() => ({}))) as any;
  const callSid = form.CallSid as string | undefined;
  const rawStatus = form.CallStatus as string | undefined;
  const duration = form.CallDuration ? Number(form.CallDuration) : null;
  // Map Twilio statuses onto our callStatusEnum. Unknown statuses still get saved
  // (Twilio adds new ones occasionally) but they fall through to "initiated".
  const allowedStatuses = ["queued", "initiated", "ringing", "in_progress", "completed", "failed", "no_answer", "busy", "voicemail"] as const;
  type CallStatus = (typeof allowedStatuses)[number];
  const status: CallStatus = (allowedStatuses as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as CallStatus)
    : "initiated";
  if (callSid) {
    const db = getDb();
    const done = ["completed", "failed", "busy", "no-answer", "canceled"].includes(rawStatus ?? "");
    await db
      .update(calls)
      .set({
        status,
        ...(Number.isFinite(duration) ? { duration } : {}),
        ...(done ? { endedAt: new Date() } : {}),
      })
      .where(eq(calls.callSid, callSid));
  }
  return c.json({ received: true });
});

// Transcript ingestion from the voice gateway (end of call).
// Authenticated with a shared secret: X-Transcript-Token must match the
// tenant's conversationWsToken (same token used on the WS URL).
webhooks.post("/twilio/transcript", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body?.callSid || !Array.isArray(body?.messages)) {
    return c.json({ error: "callSid and messages[] required" }, 400);
  }
  const db = getDb();
  const call = await db.query.calls.findFirst({ where: eq(calls.callSid, body.callSid) });
  if (!call) return c.json({ error: "unknown callSid" }, 404);
  const cred = await getCredentialsForTenant(call.tenantId);
  const token = c.req.header("X-Transcript-Token") || "";
  if (cred?.conversationWsToken && token !== cred.conversationWsToken) {
    return c.json({ error: "forbidden" }, 403);
  }
  for (const m of body.messages.slice(0, 500)) {
    if (m?.content) {
      await db.insert(transcripts).values({
        tenantId: call.tenantId,
        callId: call.id,
        role: String(m.role || "user").slice(0, 16),
        content: String(m.content).slice(0, 8000),
      });
    }
  }
  await db
    .update(calls)
    .set({ status: "completed", endedAt: new Date(), outcome: body.outcome || "completed" })
    .where(eq(calls.id, call.id));
  return c.json({ ok: true, saved: body.messages.length });
});
