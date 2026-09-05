// AI Assistant integrations — Google Calendar / Gmail / Outlook stubs.
//
// For v1 we don't have real OAuth apps set up. So we provide a MOCK flow:
// the UI shows a "Connect Google" button that takes you through a fake
// OAuth dance, then marks the integration as connected. The mock provider
// returns deterministic fake data (3 calendar events, 2 emails, etc.)
// so the rest of the system can be exercised end-to-end.
//
// When the user is ready to wire real Google/Outlook, the function shapes
// stay the same — only the internals of these helpers change to call the
// real Google Calendar / Gmail / Microsoft Graph APIs.

import { randomUUID } from "node:crypto";

export type IntegrationProvider =
  | "google_calendar"
  | "outlook_calendar"
  | "google_gmail"
  | "microsoft_graph";

// The shape of a calendar event as returned by the integration layer
// (regardless of provider). Our DB layer normalizes into this.
export type NormalizedCalendarEvent = {
  externalId: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees: string[];
  meetingUrl?: string;
};

// The shape of a draft email
export type NormalizedEmailMessage = {
  externalId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: Date;
  isUnread: boolean;
};

// ── Mock data generators ────────────────────────────────────────────
// Deterministic based on the tenant id (so the same tenant always sees
// the same fake data, but different tenants see different data).

function seedFromTenant(tenantId: number, salt: string): number {
  let h = 2166136261;
  const s = `${tenantId}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mockEvent(index: number, tenantId: number): NormalizedCalendarEvent {
  const seed = seedFromTenant(tenantId, `event-${index}`);
  const titles = [
    "Discovery call with Acme Corp",
    "Quarterly business review",
    "Demo: Premium Meridian product line",
    "Intro chat with Coastal Vanguard",
    "Pricing alignment call",
    "Technical deep-dive",
    "Onboarding planning",
    "Follow-up: contract review",
  ];
  const days = [1, 2, 3, 5, 7, 10, 14, 21];
  const hours = [9, 10, 11, 13, 14, 15, 16];
  const durMin = [30, 30, 45, 60, 60, 60, 90];
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() + days[seed % days.length]);
  start.setHours(hours[seed % hours.length], 0, 0, 0);
  const end = new Date(start.getTime() + durMin[seed % durMin.length] * 60 * 1000);
  return {
    externalId: `mock-event-${tenantId}-${index}-${seed.toString(36)}`,
    title: titles[seed % titles.length],
    description: "Mock event for AI Assistant demo. Not a real calendar entry.",
    startsAt: start,
    endsAt: end,
    timeZone: "America/New_York",
    attendees: ["david@premiummeridian.org"],
    meetingUrl: `https://meet.google.com/mock-${seed.toString(36).slice(0, 6)}`,
  };
}

function mockEmail(index: number, tenantId: number): NormalizedEmailMessage {
  const seed = seedFromTenant(tenantId, `email-${index}`);
  const subjects = [
    "Re: Pricing for Q4",
    "Quick question on the peptide catalog",
    "Following up on our last call",
    "Intro from a friend at Acme",
    "Cancel my subscription?",
    "Need a refill on my protocol",
    "Question about the on-call coverage",
    "Loved the demo yesterday",
  ];
  const senders = [
    "sarah@acmecorp.com",
    "mike@dentalcare.io",
    "ops@coastalvanguard.com",
    "no-reply@stripe.com",
    "support@premiummeridian.org",
  ];
  const isUnread = index % 2 === 0;
  const now = new Date();
  const receivedAt = new Date(now);
  receivedAt.setHours(now.getHours() - (index + 1) * 2);
  return {
    externalId: `mock-email-${tenantId}-${index}-${seed.toString(36)}`,
    from: senders[seed % senders.length],
    to: "david@premiummeridian.org",
    subject: subjects[seed % subjects.length],
    body: `Hi David,\n\nThis is a mock email #${index + 1} for the AI Assistant demo. The body here is fake — it's just there so the email triage UI has something to render. The real implementation would hit Gmail / Outlook via OAuth and return actual messages.\n\nBest,\n${senders[seed % senders.length].split("@")[0]}`,
    receivedAt,
    isUnread,
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Start the OAuth flow for a provider. Returns a URL the user should be
 * redirected to. In the mock implementation, we just return a callback
 * URL that "completes" the flow immediately.
 */
export function startOAuthFlow(opts: {
  provider: IntegrationProvider;
  tenantId: number;
  redirectUri: string;
}): { authUrl: string; state: string } {
  const state = randomUUID();
  // The real flow would return something like:
  //   https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&state=...
  // The mock flow returns a redirect to our own /api/assistant/integrations/callback
  // with a state param the callback will use to complete the integration.
  const u = new URL(opts.redirectUri);
  u.searchParams.set("provider", opts.provider);
  u.searchParams.set("state", state);
  u.searchParams.set("mock", "1");
  return { authUrl: u.toString(), state };
}

/**
 * Complete the OAuth flow (the callback from the provider).
 * In the mock implementation, we accept the redirect and return
 * synthetic tokens + a fake user identity.
 */
export function completeOAuthFlow(opts: {
  provider: IntegrationProvider;
  tenantId: number;
  state: string;
}): {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  externalUserId: string;
  externalUserEmail: string;
} {
  // Mock tokens are just identifiers — no real auth happens.
  const accessToken = `mock-access-${opts.tenantId}-${opts.provider}-${Date.now()}`;
  const refreshToken = `mock-refresh-${opts.tenantId}-${opts.provider}-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
  return {
    accessToken,
    refreshToken,
    expiresAt,
    externalUserId: `mock-user-${opts.tenantId}`,
    externalUserEmail: "david@premiummeridian.org",
  };
}

/**
 * Fetch calendar events for a connected integration.
 * Mock implementation: returns 3 deterministic fake events.
 */
export function fetchCalendarEvents(opts: {
  provider: IntegrationProvider;
  accessToken: string;
  tenantId: number;
  fromDate: Date;
  toDate: Date;
}): NormalizedCalendarEvent[] {
  if (opts.accessToken.startsWith("mock-access")) {
    return [0, 1, 2].map((i) => mockEvent(i, opts.tenantId));
  }
  // Real implementation: hit Google Calendar API or Microsoft Graph.
  // Wire-up deferred.
  return [];
}

/**
 * Create a calendar event via the provider.
 * Mock implementation: echoes the input back as a fake event.
 */
export function createCalendarEvent(opts: {
  provider: IntegrationProvider;
  accessToken: string;
  tenantId: number;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees: string[];
}): NormalizedCalendarEvent {
  if (opts.accessToken.startsWith("mock-access")) {
    return {
      externalId: `mock-event-new-${opts.tenantId}-${Date.now()}`,
      title: opts.title,
      description: opts.description,
      startsAt: opts.startsAt,
      endsAt: opts.endsAt,
      timeZone: opts.timeZone,
      attendees: opts.attendees,
      meetingUrl: `https://meet.google.com/mock-${Math.random().toString(36).slice(2, 8)}`,
    };
  }
  throw new Error(`Real ${opts.provider} integration not configured yet.`);
}

/**
 * Fetch inbox (unread or recent) for a connected Gmail/Microsoft Graph.
 * Mock: returns 4 fake emails.
 */
export function fetchInbox(opts: {
  provider: IntegrationProvider;
  accessToken: string;
  tenantId: number;
  unreadOnly: boolean;
  limit: number;
}): NormalizedEmailMessage[] {
  if (opts.accessToken.startsWith("mock-access")) {
    const all = [0, 1, 2, 3].map((i) => mockEmail(i, opts.tenantId));
    return opts.unreadOnly ? all.filter((e) => e.isUnread) : all;
  }
  return [];
}

/**
 * Send a draft email via the provider. The AI NEVER calls this — only
 * the owner does, after approving a draft. The mock just returns a
 * fake provider ref.
 */
export function sendEmail(opts: {
  provider: IntegrationProvider;
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}): { providerRef: string } {
  if (opts.accessToken.startsWith("mock-access")) {
    return { providerRef: `mock-send-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
  }
  throw new Error(`Real ${opts.provider} integration not configured yet.`);
}
