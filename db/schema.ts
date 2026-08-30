import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  boolean,
  int,
  timestamp,
  bigint,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ── Per-client provider credentials (Twilio + SMTP + WS gateway) ──
export const credentials = mysqlTable("credentials", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  twilioAccountSid: varchar("twilioAccountSid", { length: 128 }),
  twilioAuthToken: varchar("twilioAuthToken", { length: 128 }),
  twilioPhoneNumber: varchar("twilioPhoneNumber", { length: 32 }),
  twilioWhatsappNumber: varchar("twilioWhatsappNumber", { length: 32 }),
  smtpHost: varchar("smtpHost", { length: 255 }),
  smtpPort: int("smtpPort"),
  smtpUser: varchar("smtpUser", { length: 255 }),
  smtpPass: varchar("smtpPass", { length: 255 }),
  smtpFrom: varchar("smtpFrom", { length: 255 }),
  wsGatewayUrl: varchar("wsGatewayUrl", { length: 512 }),
  conversationWsToken: varchar("conversationWsToken", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}, (t) => [uniqueIndex("credentials_userId_idx").on(t.userId)]);

export type Credential = typeof credentials.$inferSelect;

// ── AI agents: client-programmable voice personas ──
export const agents = mysqlTable("agents", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  category: mysqlEnum("category", [
    "inbound_support",
    "outbound_sales",
    "appointment_reminder",
    "personal_assistant",
    "custom",
  ]).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound", "both"]).notNull(),
  systemPrompt: text("systemPrompt").notNull(),
  openingLine: text("openingLine"),
  voiceId: varchar("voiceId", { length: 64 }).default("TxGEqnHWrfWFTfGW9XjX").notNull(),
  model: varchar("model", { length: 64 }).default("gpt-4o-mini").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Agent = typeof agents.$inferSelect;

// ── Calls ──
export const calls = mysqlTable("calls", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  agentId: bigint("agentId", { mode: "number", unsigned: true }),
  callSid: varchar("callSid", { length: 64 }).notNull(),
  direction: mysqlEnum("direction", ["inbound", "outbound"]).notNull(),
  toNumber: varchar("toNumber", { length: 32 }).notNull(),
  fromNumber: varchar("fromNumber", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).default("initiated").notNull(),
  outcome: varchar("outcome", { length: 64 }),
  duration: int("duration"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
}, (t) => [uniqueIndex("calls_callSid_idx").on(t.callSid)]);

export type Call = typeof calls.$inferSelect;

// ── Transcript lines ──
export const transcripts = mysqlTable("transcripts", {
  id: serial("id").primaryKey(),
  callId: bigint("callId", { mode: "number", unsigned: true }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Transcript = typeof transcripts.$inferSelect;

// ── Contacts + DNC ──
export const contacts = mysqlTable("contacts", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  email: varchar("email", { length: 320 }),
  tags: varchar("tags", { length: 255 }),
  dnc: boolean("dnc").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [uniqueIndex("contacts_user_phone_idx").on(t.userId, t.phone)]);

export type Contact = typeof contacts.$inferSelect;

// ── Outbound messages (WhatsApp / email / SMS) ──
export const messages = mysqlTable("messages", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  channel: mysqlEnum("channel", ["whatsapp", "email", "sms"]).notNull(),
  toAddr: varchar("toAddr", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body").notNull(),
  status: varchar("status", { length: 32 }).default("queued").notNull(),
  providerRef: varchar("providerRef", { length: 128 }),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
