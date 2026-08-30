// Twilio REST API via fetch (Basic auth) — no SDK dependency.
// Every function takes the CLIENT'S own credentials (multi-tenant SaaS).

export type TwilioCreds = {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  whatsappNumber?: string | null;
};

function authHeader(c: TwilioCreds) {
  return "Basic " + Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64");
}

async function twilioPost(c: TwilioCreds, path: string, params: Record<string, string>) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(c),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(`Twilio ${res.status}: ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

export async function twilioCreateCall(
  c: TwilioCreds,
  opts: { to: string; twimlUrl: string; statusCallbackUrl: string },
) {
  return twilioPost(c, "Calls.json", {
    To: opts.to,
    From: c.phoneNumber,
    Url: opts.twimlUrl,
    StatusCallback: opts.statusCallbackUrl,
    StatusCallbackEvent: ["initiated", "ringing", "answered", "completed"].join(" "),
    StatusCallbackMethod: "POST",
  });
}

export async function twilioSendSms(c: TwilioCreds, to: string, body: string) {
  return twilioPost(c, "Messages.json", { To: to, From: c.phoneNumber, Body: body });
}

export async function twilioSendWhatsApp(c: TwilioCreds, to: string, body: string) {
  const from = c.whatsappNumber || c.phoneNumber;
  const norm = (n: string) => (n.startsWith("whatsapp:") ? n : `whatsapp:${n}`);
  return twilioPost(c, "Messages.json", { To: norm(to), From: norm(from), Body: body });
}

export async function twilioTestCredentials(c: TwilioCreds) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}.json`;
  const res = await fetch(url, { headers: { Authorization: authHeader(c) } });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message || "invalid credentials"}`);
  return { friendlyName: data.friendly_name, status: data.status };
}

// TwiML for ConversationRelay — the voice AI loop runs on the client's
// WebSocket gateway (same architecture as the Coastal deployment).
export function buildConversationRelayTwiML(opts: {
  wsUrl: string;
  token?: string | null;
  agentId: number;
  openingLine?: string | null;
  voiceId: string;
  leadName?: string | null;
  actionUrl: string;
}) {
  let ws = `${opts.wsUrl}?agent_id=${opts.agentId}`;
  if (opts.token) ws += `&token=${encodeURIComponent(opts.token)}`;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const greeting = opts.openingLine ? ` welcomeGreeting="${esc(opts.openingLine)}"` : "";
  const params = opts.leadName
    ? `<Parameter name="lead_name" value="${esc(opts.leadName)}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${esc(opts.actionUrl)}">
    <ConversationRelay url="${esc(ws)}" ttsProvider="ElevenLabs" voice="${esc(opts.voiceId)}" transcriptionProvider="Deepgram" speechModel="nova-2-general" interruptible="any" interruptSensitivity="medium"${greeting}>
      ${params}
    </ConversationRelay>
  </Connect>
</Response>`;
}
