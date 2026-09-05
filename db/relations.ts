// Drizzle relations for the AI Caller admin schema.
// These are needed for Drizzle's relational query API (used by tRPC routers).

import { relations } from "drizzle-orm";
import {
  tenants,
  users,
  tenantMembers,
  verticals,
  credentials,
  agentConfigs,
  calls,
  transcripts,
  contacts,
  messages,
  auditLog,
  assistantIntegrations,
  assistantCalendarEvents,
  assistantEmailDrafts,
  assistantCallTasks,
  assistantReminders,
  assistantContactNotes,
} from "./schema";

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  members: many(tenantMembers),
  verticals: many(verticals),
  credentials: many(credentials),
  agentConfigs: many(agentConfigs),
  calls: many(calls),
  contacts: many(contacts),
  messages: many(messages),
  auditLog: many(auditLog),
  assistantIntegrations: many(assistantIntegrations),
  assistantCalendarEvents: many(assistantCalendarEvents),
  assistantEmailDrafts: many(assistantEmailDrafts),
  assistantCallTasks: many(assistantCallTasks),
  assistantReminders: many(assistantReminders),
  assistantContactNotes: many(assistantContactNotes),
  owner: one(users, {
    fields: [tenants.ownerUserId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  memberships: many(tenantMembers),
  defaultTenant: one(tenants, {
    fields: [users.defaultTenantId],
    references: [tenants.id],
  }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tenantMembers.userId],
    references: [users.id],
  }),
}));

export const verticalsRelations = relations(verticals, ({ one, many }) => ({
  owner: one(tenants, {
    fields: [verticals.ownerTenantId],
    references: [tenants.id],
  }),
  agentConfigs: many(agentConfigs),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  tenant: one(tenants, {
    fields: [credentials.tenantId],
    references: [tenants.id],
  }),
}));

export const agentConfigsRelations = relations(agentConfigs, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [agentConfigs.tenantId],
    references: [tenants.id],
  }),
  vertical: one(verticals, {
    fields: [agentConfigs.verticalId],
    references: [verticals.id],
  }),
  calls: many(calls),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [calls.tenantId],
    references: [tenants.id],
  }),
  agentConfig: one(agentConfigs, {
    fields: [calls.agentConfigId],
    references: [agentConfigs.id],
  }),
  transcripts: many(transcripts),
  messages: many(messages),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [transcripts.tenantId],
    references: [tenants.id],
  }),
  call: one(calls, {
    fields: [transcripts.callId],
    references: [calls.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [contacts.tenantId],
    references: [tenants.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  tenant: one(tenants, {
    fields: [messages.tenantId],
    references: [tenants.id],
  }),
  call: one(calls, {
    fields: [messages.callId],
    references: [calls.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLog.tenantId],
    references: [tenants.id],
  }),
  actor: one(users, {
    fields: [auditLog.actorUserId],
    references: [users.id],
  }),
}));


// ── Assistant relations ───────────────────────────────────────────────
export const assistantIntegrationsRelations = relations(assistantIntegrations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantIntegrations.tenantId],
    references: [tenants.id],
  }),
}));

export const assistantCalendarEventsRelations = relations(assistantCalendarEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantCalendarEvents.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [assistantCalendarEvents.contactId],
    references: [contacts.id],
  }),
  call: one(calls, {
    fields: [assistantCalendarEvents.callId],
    references: [calls.id],
  }),
}));

export const assistantEmailDraftsRelations = relations(assistantEmailDrafts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantEmailDrafts.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [assistantEmailDrafts.contactId],
    references: [contacts.id],
  }),
  call: one(calls, {
    fields: [assistantEmailDrafts.callId],
    references: [calls.id],
  }),
}));

export const assistantCallTasksRelations = relations(assistantCallTasks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantCallTasks.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [assistantCallTasks.contactId],
    references: [contacts.id],
  }),
  call: one(calls, {
    fields: [assistantCallTasks.callId],
    references: [calls.id],
  }),
}));

export const assistantRemindersRelations = relations(assistantReminders, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantReminders.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [assistantReminders.contactId],
    references: [contacts.id],
  }),
  call: one(calls, {
    fields: [assistantReminders.callId],
    references: [calls.id],
  }),
}));

export const assistantContactNotesRelations = relations(assistantContactNotes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [assistantContactNotes.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [assistantContactNotes.contactId],
    references: [contacts.id],
  }),
  call: one(calls, {
    fields: [assistantContactNotes.callId],
    references: [calls.id],
  }),
}));

// ── Add relations on the existing tables that link to assistant_* ─────
export const contactsWithAssistantRelations = relations(contacts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [contacts.tenantId],
    references: [tenants.id],
  }),
  calendarEvents: many(assistantCalendarEvents),
  emailDrafts: many(assistantEmailDrafts),
  callTasks: many(assistantCallTasks),
  reminders: many(assistantReminders),
  notes: many(assistantContactNotes),
}));

export const callsWithAssistantRelations = relations(calls, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [calls.tenantId],
    references: [tenants.id],
  }),
  agentConfig: one(agentConfigs, {
    fields: [calls.agentConfigId],
    references: [agentConfigs.id],
  }),
  transcripts: many(transcripts),
  messages: many(messages),
  calendarEvents: many(assistantCalendarEvents),
  emailDrafts: many(assistantEmailDrafts),
  callTasks: many(assistantCallTasks),
  reminders: many(assistantReminders),
  notes: many(assistantContactNotes),
}));
