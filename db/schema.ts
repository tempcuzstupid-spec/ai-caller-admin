// AI Caller admin dashboard — multi-tenant, multi-vertical schema (Postgres).
//
// Tenant model: one tenant = one customer (Premium Meridian, a dental practice, etc.).
// Vertical model: one vertical = one industry/use-case template (peptides, dental, etc.).
// Each tenant can deploy one or more verticals. Each agent = a tenant's instantiation of
// a vertical (with customizations: prompt tweaks, voice, opening line, catalog, etc.).
//
// HIPAA-ready architecture: row-level isolation via tenant_id on every business table.
// Per-tenant encryption keys + audit-log-of-PHI-reads are not implemented yet (basic
// row isolation for now). The `compliance_tier` enum + `phi_classification` columns are
// in place so the upgrade path is data-only, not a schema migration.

import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  bigint,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum("user_role", ["user", "admin", "owner"]);
export const complianceTierEnum = pgEnum("compliance_tier", ["basic", "hipaa"]);
export const phiClassificationEnum = pgEnum("phi_classification", [
  "none", // No PHI / PII in this row.
  "pii",  // Personally identifiable but not health (name, phone, email).
  "phi",  // Protected health information — health-adjacent.
]);
export const verticalCategoryEnum = pgEnum("vertical_category", [
  // General categories (generalizable prompts)
  "inbound_support",
  "outbound_sales",
  "appointment_reminder",
  "personal_assistant",
  // Vertical-specific (industry-tuned prompts)
  "peptides_wellness",
  "dental_practice",
  "legal_intake",
  "real_estate",
  "home_services",
  "b2b_saas",
  "hospitality",
  // User-created
  "custom",
]);
export const directionEnum = pgEnum("direction", ["inbound", "outbound", "both"]);
export const callDirectionEnum = pgEnum("call_direction", ["inbound", "outbound"]);
export const callStatusEnum = pgEnum("call_status", [
  "queued", "initiated", "ringing", "answered", "in_progress", "completed", "failed", "no_answer", "busy", "voicemail",
]);
export const messageChannelEnum = pgEnum("message_channel", ["whatsapp", "email", "sms"]);
export const messageStatusEnum = pgEnum("message_status", [
  "queued", "sent", "delivered", "read", "failed", "opted_out",
]);
export const auditActionEnum = pgEnum("audit_action", [
  "create", "read", "update", "delete", "login", "logout", "export", "phi_access", "config_change", "preview",
]);


// ── Assistant enums ───────────────────────────────────────────────────

// External service the tenant has connected for the AI assistant
export const integrationProviderEnum = pgEnum("integration_provider", [
  "google_calendar",  // Google Calendar via Google OAuth
  "outlook_calendar", // Microsoft Outlook calendar
  "google_gmail",     // Gmail for email triage
  "microsoft_graph",  // Outlook + MS Graph
]);
export const integrationStatusEnum = pgEnum("integration_status", [
  "disconnected", // not connected
  "pending",      // OAuth flow started, awaiting callback
  "connected",    // tokens valid, integration live
  "expired",      // refresh token expired, need re-auth
  "error",        // last operation failed, needs admin attention
]);

// Calendar events: who initiated + who attends
export const calendarEventSourceEnum = pgEnum("calendar_event_source", [
  "owner",         // owner booked it manually
  "ai_assistant",  // AI booked it on the owner's behalf
  "external",      // someone else booked it
]);
export const calendarEventStatusEnum = pgEnum("calendar_event_status", [
  "scheduled",     // future
  "completed",     // past, attended
  "cancelled",     // cancelled
  "rescheduled",   // moved to a new time (we keep the original row)
  "no_show",       // past, didn't attend
]);

// Email drafts the AI composed on the owner's behalf (never auto-send)
export const emailDraftStatusEnum = pgEnum("email_draft_status", [
  "draft",        // AI wrote, owner hasn't reviewed
  "approved",     // owner approved, ready to send
  "sent",         // sent via provider
  "rejected",     // owner rejected
  "edited",       // owner edited then approved
]);

// AI-driven outbound call tasks (different from sales vertical's reactive calls)
export const callTaskStatusEnum = pgEnum("call_task_status", [
  "pending",      // queued, not yet placed
  "scheduled",    // scheduled for a future time
  "placed",       // call placed, in progress
  "completed",    // call completed (any outcome)
  "failed",       // bridge / dial failed
  "cancelled",    // owner cancelled before placement
]);

// Reminders the AI set on the owner's behalf
export const reminderChannelEnum = pgEnum("reminder_channel", [
  "sms",          // text the owner
  "call",         // place a call to the owner at the time
  "email",        // email the owner
]);
export const reminderStatusEnum = pgEnum("reminder_status", [
  "active",       // waiting to fire
  "fired",        // delivered
  "cancelled",    // owner cancelled
  "failed",       // delivery failed
]);

// ── Tenants ────────────────────────────────────────────────────────────
// One row per customer. The whole product pivots around tenant_id.

export const tenants = pgTable("admin_tenants", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  ownerUserId: bigint("owner_user_id", { mode: "number" }),
  // Brand
  brandName: varchar("brand_name", { length: 255 }).notNull(),
  brandDomain: varchar("brand_domain", { length: 255 }),
  brandPhone: varchar("brand_phone", { length: 32 }),
  brandEmail: varchar("brand_email", { length: 320 }),
  brandLegalName: varchar("brand_legal_name", { length: 255 }),
  // Compliance
  complianceTier: complianceTierEnum("compliance_tier").default("basic").notNull(),
  // When compliance_tier = "hipaa", this references the per-tenant KMS key.
  // For "basic", null. Wire up to AWS KMS / GCP KMS when first HIPAA client signs.
  encryptionKeyId: varchar("encryption_key_id", { length: 255 }),
  // Status
  active: boolean("active").default(true).notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Tenant = typeof tenants.$inferSelect;

// ── Users (auth) ───────────────────────────────────────────────────────
// A user can belong to multiple tenants. The default tenant is set on login.
// For now, the schema supports multi-tenant membership; the UI surface for it
// is post-launch.

export const users = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  unionId: varchar("union_id", { length: 255 }).notNull().unique(),
  defaultTenantId: bigint("default_tenant_id", { mode: "number" }).references(() => tenants.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("last_sign_in_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;

// ── Tenant membership ──────────────────────────────────────────────────

export const tenantMembers = pgTable("admin_tenant_members", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("tenant_members_unique").on(t.tenantId, t.userId)]);

// ── Verticals (industry templates) ─────────────────────────────────────
// Verticals are reusable templates. A "starter" vertical is published with the
// platform (peptides, dental, etc.). Tenants either pick a starter or build
// their own (visibility = "private" / "tenant" / "public").
//
// The actual defaultPrompt + defaultOpening + compliance_tier + qualification
// flow live in the AGENT_CATEGORIES constant in contracts/catalog.ts (compiled
// into the bundle). This table stores the per-tenant instantiation + metadata.

export const verticals = pgTable("admin_verticals", {
  id: serial("id").primaryKey(),
  // For starter verticals, ownerTenantId is null and category is the canonical enum.
  // For tenant-built verticals, ownerTenantId is the tenant that owns it.
  ownerTenantId: bigint("owner_tenant_id", { mode: "number" }).references(() => tenants.id, { onDelete: "cascade" }),
  category: verticalCategoryEnum("category").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  // Direction: which way this vertical handles calls. A peptide sales vertical
  // would be "outbound"; a dental recare vertical "outbound"; a reservations
  // vertical "inbound". Custom verticals default to "both".
  direction: directionEnum("direction").default("both").notNull(),
  // "private" = only owner can see, "tenant" = visible to all members of a specific tenant,
  // "public" = platform marketplace, cloneable by anyone.
  visibility: varchar("visibility", { length: 16 }).default("private").notNull(),
  // Compliance hint for the vertical (a peptide vertical would default to "hipaa";
  // a dental practice to "hipaa"; a real estate agent to "basic").
  defaultComplianceTier: complianceTierEnum("default_compliance_tier").default("basic").notNull(),
  // The actual prompt + opening are in the bundle (contracts/catalog.ts).
  // This table is the metadata + per-tenant override surface.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Vertical = typeof verticals.$inferSelect;

// ── Credentials (per-tenant Twilio + SMTP + WS gateway) ────────────────

export const credentials = pgTable("admin_credentials", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  twilioAccountSid: varchar("twilio_account_sid", { length: 128 }),
  twilioAuthToken: varchar("twilio_auth_token", { length: 128 }),
  twilioPhoneNumber: varchar("twilio_phone_number", { length: 32 }),
  twilioWhatsappNumber: varchar("twilio_whatsapp_number", { length: 32 }),
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: integer("smtp_port"),
  smtpUser: varchar("smtp_user", { length: 255 }),
  smtpPass: varchar("smtp_pass", { length: 255 }),
  smtpFrom: varchar("smtp_from", { length: 255 }),
  wsGatewayUrl: varchar("ws_gateway_url", { length: 512 }),
  conversationWsToken: varchar("conversation_ws_token", { length: 128 }),
  // A FastAPI backend URL (where the AI Caller engine runs) per-tenant or shared.
  // Most tenants share a single FastAPI deployment; enterprise tenants can run
  // their own. Per-tenant URL is the future.
  fastApiUrl: varchar("fast_api_url", { length: 512 }),
  fastApiAdminKey: varchar("fast_api_admin_key", { length: 128 }),
  phiClassification: phiClassificationEnum("phi_classification").default("none").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [uniqueIndex("credentials_tenant_idx").on(t.tenantId)]);

export type Credential = typeof credentials.$inferSelect;

// ── Agent configs (tenant x vertical, with customizations) ─────────────
// The "agent" is the runtime instance a tenant deploys. It's a join between
// a tenant and a vertical, with overrides.

export const agentConfigs = pgTable("admin_agent_configs", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  verticalId: bigint("vertical_id", { mode: "number" }).notNull().references(() => verticals.id, { onDelete: "cascade" }),
  // The user-given name (e.g. "Marcus — Peptide Sales", "Aria — Dental Recare")
  name: varchar("name", { length: 120 }).notNull(),
  // Overrides (null = use vertical defaults)
  systemPromptOverride: text("system_prompt_override"),
  openingLineOverride: text("opening_line_override"),
  voiceId: varchar("voice_id", { length: 64 }).default("TxGEqnHWrfWFTfGW9XjX").notNull(),
  model: varchar("model", { length: 64 }).default("gpt-4o-mini").notNull(),
  // The Twilio numbers this agent picks up / calls from (CSV).
  fromNumbers: text("from_numbers").default("").notNull(),
  // Handoff (warm transfer) number
  handoffNumber: varchar("handoff_number", { length: 32 }),
  // Per-tenant product catalog (JSONB). Empty = use vertical's default catalog
  // (which is also JSONB, defined per-vertical in the catalog.ts bundle).
  catalog: jsonb("catalog").$type<Array<{
    sku: string;
    name: string;
    description: string;
    priceUsd: number;
    category: string;
  }>>().default([]).notNull(),
  // Compliance — may upgrade from vertical default (peptide vertical = hipaa,
  // but a specific tenant using it for non-health = basic override allowed).
  complianceTier: complianceTierEnum("compliance_tier").default("basic").notNull(),
  // Twilio webhooks configured for this agent
  twilioVoiceWebhookUrl: varchar("twilio_voice_webhook_url", { length: 512 }),
  twilioSmsWebhookUrl: varchar("twilio_sms_webhook_url", { length: 512 }),
  twilioStatusCallbackUrl: varchar("twilio_status_callback_url", { length: 512 }),
  // Status
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("agent_configs_tenant_name_idx").on(t.tenantId, t.name),
  index("agent_configs_tenant_idx").on(t.tenantId),
]);

export type AgentConfig = typeof agentConfigs.$inferSelect;

// ── Calls ──────────────────────────────────────────────────────────────

export const calls = pgTable("admin_calls", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  agentConfigId: bigint("agent_config_id", { mode: "number" }).references(() => agentConfigs.id, { onDelete: "set null" }),
  // Twilio's call SID (for status callbacks, recording lookups)
  callSid: varchar("call_sid", { length: 64 }).notNull().unique(),
  direction: callDirectionEnum("direction").notNull(),
  toNumber: varchar("to_number", { length: 32 }).notNull(),
  fromNumber: varchar("from_number", { length: 32 }).notNull(),
  status: callStatusEnum("status").default("initiated").notNull(),
  outcome: varchar("outcome", { length: 64 }),
  duration: integer("duration"),
  // Cost tracking (Twilio + Deepgram + OpenAI + ElevenLabs in cents)
  costTwilioCents: integer("cost_twilio_cents").default(0).notNull(),
  costDeepgramCents: integer("cost_deepgram_cents").default(0).notNull(),
  costOpenaiCents: integer("cost_openai_cents").default(0).notNull(),
  costElevenlabsCents: integer("cost_elevenlabs_cents").default(0).notNull(),
  // Lead data captured during the call
  leadName: varchar("lead_name", { length: 255 }),
  leadEmail: varchar("lead_email", { length: 320 }),
  leadContext: text("lead_context"),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  // Recording URL (Twilio) — encrypted at rest for hipaa tier
  recordingUrl: text("recording_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
}, (t) => [index("calls_tenant_idx").on(t.tenantId)]);

export type Call = typeof calls.$inferSelect;

// ── Transcript lines ───────────────────────────────────────────────────

export const transcripts = pgTable("admin_transcripts", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  callId: bigint("call_id", { mode: "number" }).notNull().references(() => calls.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(), // "user" | "assistant" | "tool"
  content: text("content").notNull(),
  // Tool call data, if any
  toolName: varchar("tool_name", { length: 64 }),
  toolArgs: jsonb("tool_args"),
  // PHI classification of this line (e.g., "I take metformin" = phi)
  phiClassification: phiClassificationEnum("phi_classification").default("none").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("transcripts_tenant_call_idx").on(t.tenantId, t.callId)]);

export type Transcript = typeof transcripts.$inferSelect;

// ── Contacts + DNC ─────────────────────────────────────────────────────

export const contacts = pgTable("admin_contacts", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  email: varchar("email", { length: 320 }),
  tags: varchar("tags", { length: 255 }),
  dnc: boolean("dnc").default(false).notNull(),
  // Source — where did this contact come from? (inbound_call, manual, import, etc.)
  source: varchar("source", { length: 32 }).default("manual").notNull(),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("contacts_tenant_phone_idx").on(t.tenantId, t.phone)]);

export type Contact = typeof contacts.$inferSelect;

// ── Outbound messages (WhatsApp / email / SMS) ─────────────────────────

export const messages = pgTable("admin_messages", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  channel: messageChannelEnum("channel").notNull(),
  toAddr: varchar("to_addr", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body").notNull(),
  status: messageStatusEnum("status").default("queued").notNull(),
  providerRef: varchar("provider_ref", { length: 128 }),
  error: text("error"),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [index("messages_tenant_idx").on(t.tenantId)]);

export type Message = typeof messages.$inferSelect;

// ── Audit log ──────────────────────────────────────────────────────────
// Every admin action, every PHI read, every config change. The shape is
// generic so the same table covers all compliance + operational needs.
//
// For basic compliance_tier tenants, we only log admin actions.
// For hipaa compliance_tier tenants, we also log every PHI read.

export const auditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).references(() => tenants.id, { onDelete: "cascade" }),
  actorUserId: bigint("actor_user_id", { mode: "number" }).references(() => users.id, { onDelete: "set null" }),
  // "system" for background jobs (e.g., webhook handlers), "user" for interactive
  actorType: varchar("actor_type", { length: 32 }).default("user").notNull(),
  action: auditActionEnum("action").notNull(),
  // The resource this action was performed on
  resourceType: varchar("resource_type", { length: 64 }).notNull(), // "call" | "transcript" | "agent_config" | etc.
  resourceId: varchar("resource_id", { length: 64 }),
  // Free-form details (JSONB)
  details: jsonb("details"),
  // IP / user agent when available
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("audit_log_tenant_idx").on(t.tenantId, t.createdAt),
  index("audit_log_actor_idx").on(t.actorUserId, t.createdAt),
]);

export type AuditLog = typeof auditLog.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// AI ASSISTANT — Owner-facing executive-assistant surface
// ══════════════════════════════════════════════════════════════════════

export const assistantIntegrations = pgTable("admin_assistant_integrations", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: integrationProviderEnum("provider").notNull(),
  status: integrationStatusEnum("status").default("disconnected").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  externalUserId: varchar("external_user_id", { length: 255 }),
  externalUserEmail: varchar("external_user_email", { length: 320 }),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  index("assistant_integrations_tenant_idx").on(t.tenantId),
  uniqueIndex("assistant_integrations_tenant_provider_idx").on(t.tenantId, t.provider),
]);

export type AssistantIntegration = typeof assistantIntegrations.$inferSelect;

export const assistantCalendarEvents = pgTable("admin_assistant_calendar_events", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  source: calendarEventSourceEnum("source").notNull(),
  contactId: bigint("contact_id", { mode: "number" }).references(() => contacts.id, { onDelete: "set null" }),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  externalEventId: varchar("external_event_id", { length: 255 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  attendees: text("attendees"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timeZone: varchar("time_zone", { length: 64 }).default("America/New_York").notNull(),
  meetingUrl: text("meeting_url"),
  status: calendarEventStatusEnum("status").default("scheduled").notNull(),
  notes: text("notes"),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  index("assistant_calendar_tenant_starts_idx").on(t.tenantId, t.startsAt),
  index("assistant_calendar_tenant_status_idx").on(t.tenantId, t.status),
]);

export type AssistantCalendarEvent = typeof assistantCalendarEvents.$inferSelect;

export const assistantEmailDrafts = pgTable("admin_assistant_email_drafts", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contactId: bigint("contact_id", { mode: "number" }).references(() => contacts.id, { onDelete: "set null" }),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  toAddr: text("to_addr").notNull(),
  ccAddr: text("cc_addr"),
  bccAddr: text("bcc_addr"),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  aiReasoning: text("ai_reasoning"),
  status: emailDraftStatusEnum("status").default("draft").notNull(),
  providerRef: varchar("provider_ref", { length: 255 }),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
  sentAt: timestamp("sent_at"),
}, (t) => [
  index("assistant_drafts_tenant_status_idx").on(t.tenantId, t.status),
  index("assistant_drafts_tenant_created_idx").on(t.tenantId, t.createdAt),
]);

export type AssistantEmailDraft = typeof assistantEmailDrafts.$inferSelect;

export const assistantCallTasks = pgTable("admin_assistant_call_tasks", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contactId: bigint("contact_id", { mode: "number" }).references(() => contacts.id, { onDelete: "set null" }),
  toNumber: varchar("to_number", { length: 32 }).notNull(),
  taskBrief: text("task_brief").notNull(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  status: callTaskStatusEnum("status").default("pending").notNull(),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  outcome: varchar("outcome", { length: 64 }),
  transcriptSummary: text("transcript_summary"),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  index("assistant_call_tasks_tenant_status_idx").on(t.tenantId, t.status),
  index("assistant_call_tasks_tenant_scheduled_idx").on(t.tenantId, t.scheduledFor),
]);

export type AssistantCallTask = typeof assistantCallTasks.$inferSelect;

export const assistantReminders = pgTable("admin_assistant_reminders", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contactId: bigint("contact_id", { mode: "number" }).references(() => contacts.id, { onDelete: "set null" }),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  channel: reminderChannelEnum("channel").notNull(),
  destination: varchar("destination", { length: 320 }).notNull(),
  fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
  status: reminderStatusEnum("status").default("active").notNull(),
  firedAt: timestamp("fired_at"),
  deliveryRef: varchar("delivery_ref", { length: 255 }),
  deliveryError: text("delivery_error"),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  index("assistant_reminders_tenant_status_fire_idx").on(t.tenantId, t.status, t.fireAt),
]);

export type AssistantReminder = typeof assistantReminders.$inferSelect;

export const assistantContactNotes = pgTable("admin_assistant_contact_notes", {
  id: serial("id").primaryKey(),
  tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contactId: bigint("contact_id", { mode: "number" }).notNull().references(() => contacts.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  category: varchar("category", { length: 32 }).default("general").notNull(),
  source: varchar("source", { length: 32 }).default("manual").notNull(),
  callId: bigint("call_id", { mode: "number" }).references(() => calls.id, { onDelete: "set null" }),
  phiClassification: phiClassificationEnum("phi_classification").default("pii").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("assistant_contact_notes_tenant_contact_idx").on(t.tenantId, t.contactId),
  index("assistant_contact_notes_tenant_category_idx").on(t.tenantId, t.category),
]);

export type AssistantContactNote = typeof assistantContactNotes.$inferSelect;

