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
