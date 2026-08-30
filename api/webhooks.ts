// Raw Twilio webhook endpoints (form-encoded, XML responses) — mounted on Hono.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { agents, calls, transcripts } from "@db/schema";
import { buildConversationRelayTwiML } from "./services/twilio";
import { getCredentialsForUser } from "./credentialsRouter";

export const webhooks = new Hono();

function baseUrl(req: Request) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.VITE_APP_URL || "";
  if (configured) return configured.replace(/\/$/, "");
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

// Twilio fetches TwiML when a call connects.
webhooks.post("/twilio/voice/:agentId", async (c) => {
  const agentId = Number(c.req.param("agentId"));
  if (!Number.isFinite(agentId)) return c.text("Bad agent", 400);
  const db = getDb();
  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || !agent.active) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This line is not configured. Goodbye.</Say></Response>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }
  const cred = await getCredentialsForUser(agent.userId);
  const wsUrl = cred?.wsGatewayUrl || process.env.DEFAULT_WS_GATEWAY_URL || "";
  if (!wsUrl) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>The voice gateway is not configured. Goodbye.</Say></Response>`,
      200,
      { "Content-Type": "application/xml" },
    );
  }
  const leadName = c.req.query("lead_name") || null;
  const twiml = buildConversationRelayTwiML({
    wsUrl,
    token: cred?.conversationWsToken,
    agentId: agent.id,
    openingLine: agent.direction === "inbound" ? null : agent.openingLine,
    voiceId: agent.voiceId,
    leadName,
    actionUrl: `${baseUrl(c.req.raw)}/api/webhooks/twilio/action/${agent.id}`,
  });

  // Record inbound calls (outbound calls are recorded at placement time)
  const form = await c.req.parseBody().catch(() => ({} as any));
  const callSid = (form as any).CallSid as string | undefined;
  if (callSid && agent.direction !== "outbound") {
    await db
      .insert(calls)
      .values({
        userId: agent.userId,
        agentId: agent.id,
        callSid,
        direction: "inbound",
        toNumber: ((form as any).To as string) || "",
        fromNumber: ((form as any).From as string) || "",
        status: "in-progress",
      })
      .onDuplicateKeyUpdate({ set: { status: "in-progress" } });
  }

  return c.text(twiml, 200, { "Content-Type": "application/xml" });
});

// ConversationRelay ended (or call ended) — Twilio posts here.
webhooks.post("/twilio/action/:agentId", async (c) => {
  const form = (await c.req.parseBody().catch(() => ({}))) as any;
  const callSid = form.CallSid as string | undefined;
  let handoff: any = null;
  if (form.HandoffData) {
    try { handoff = JSON.parse(form.HandoffData); } catch { /* ignore */ }
  }
  if (callSid) {
    const db = getDb();
    await db
      .update(calls)
      .set({ status: "completed", endedAt: new Date(), outcome: handoff?.reasonCode || "completed" })
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
  const status = form.CallStatus as string | undefined;
  const duration = form.CallDuration ? Number(form.CallDuration) : null;
  if (callSid && status) {
    const db = getDb();
    const done = ["completed", "failed", "busy", "no-answer", "canceled"].includes(status);
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
// user's conversationWsToken (same token used on the WS URL).
webhooks.post("/twilio/transcript", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  if (!body?.callSid || !Array.isArray(body?.messages)) {
    return c.json({ error: "callSid and messages[] required" }, 400);
  }
  const db = getDb();
  const call = await db.query.calls.findFirst({ where: eq(calls.callSid, body.callSid) });
  if (!call) return c.json({ error: "unknown callSid" }, 404);
  const cred = await getCredentialsForUser(call.userId);
  const token = c.req.header("X-Transcript-Token") || "";
  if (cred?.conversationWsToken && token !== cred.conversationWsToken) {
    return c.json({ error: "forbidden" }, 403);
  }
  for (const m of body.messages.slice(0, 500)) {
    if (m?.content) {
      await db.insert(transcripts).values({
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
