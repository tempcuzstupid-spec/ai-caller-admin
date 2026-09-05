// AI Assistant router — the "executive assistant" surface for the platform owner.
//
// All endpoints are tenant-scoped (ctx.tenant.id). Every mutation is
// audit-logged with action=create/update/delete and resourceType set
// accordingly. HIPAA-tier tenants also get a phi_access log on every read.
//
// This router doesn't talk to Twilio directly. Outbound call tasks are
// funneled through the same FastAPI bridge the sales vertical uses
// (see api/callsRouter.ts placeCall). Calendar and email integrations
// go through api/lib/assistantIntegrations.ts which has a mock provider
// for v1 and is designed to swap in real Google/Outlook later.

import { z } from "zod";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  auditLog,
  assistantIntegrations,
  assistantCalendarEvents,
  assistantEmailDrafts,
  assistantCallTasks,
  assistantReminders,
  assistantContactNotes,
  calls,
  contacts,
} from "@db/schema";
import { callFastApiJson } from "./lib/fastapi";
import { getCredentialsForTenant } from "./credentialsRouter";
import {
  startOAuthFlow,
  fetchCalendarEvents,
  createCalendarEvent,
  fetchInbox,
  sendEmail,
  type IntegrationProvider,
} from "./lib/assistantIntegrations";

function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

async function logAudit(
  ctx: any,
  action: "create" | "update" | "delete" | "read",
  resourceType: string,
  resourceId: string | null,
  details: Record<string, unknown> = {},
) {
  try {
    await getDb().insert(auditLog).values({
      tenantId: ctx.tenant?.id,
      actorUserId: ctx.user?.id,
      action,
      resourceType,
      resourceId: resourceId ?? undefined,
      details,
    });
  } catch {
    // swallow — log only
  }
}

const integrationProviderSchema = z.enum([
  "google_calendar",
  "outlook_calendar",
  "google_gmail",
  "microsoft_graph",
]);

export const assistantRouter = createRouter({
  // ════════════════════════════════════════════════════════════════════
  // Integrations — connect / disconnect / list external services
  // ════════════════════════════════════════════════════════════════════

  // List the integration connection state for this tenant
  listIntegrations: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    return getDb().query.assistantIntegrations.findMany({
      where: eq(assistantIntegrations.tenantId, tenantId),
      orderBy: [desc(assistantIntegrations.updatedAt)],
    });
  }),

  // Begin connecting a provider — returns the URL the user should be
  // redirected to. In the mock implementation, this is a callback URL
  // that immediately "completes" the flow.
  startConnectIntegration: authedQuery
    .input(z.object({ provider: integrationProviderSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      // Mark as pending (or insert new row)
      const existing = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, input.provider),
        ),
      });
      if (existing) {
        await db
          .update(assistantIntegrations)
          .set({ status: "pending" })
          .where(eq(assistantIntegrations.id, existing.id));
      } else {
        await db.insert(assistantIntegrations).values({
          tenantId,
          provider: input.provider,
          status: "pending",
        });
      }

      const redirectUri = `${process.env.PUBLIC_BASE_URL ?? ""}/api/assistant/integrations/callback`;
      const { authUrl, state } = startOAuthFlow({
        provider: input.provider as IntegrationProvider,
        tenantId,
        redirectUri,
      });

      // Persist the state in a transient field on the integration row
      // so the callback can validate it. (For a real flow we'd use a
      // signed cookie. For mock, this is fine.)
      if (existing) {
        await db
          .update(assistantIntegrations)
          .set({ lastError: `pending-state:${state}` })
          .where(eq(assistantIntegrations.id, existing.id));
      } else {
        const fresh = await db.query.assistantIntegrations.findFirst({
          where: and(
            eq(assistantIntegrations.tenantId, tenantId),
            eq(assistantIntegrations.provider, input.provider),
          ),
        });
        if (fresh) {
          await db
            .update(assistantIntegrations)
            .set({ lastError: `pending-state:${state}` })
            .where(eq(assistantIntegrations.id, fresh.id));
        }
      }

      await logAudit(ctx, "create", "integration", null, {
        provider: input.provider,
        action: "oauth_started",
      });
      return { authUrl, state };
    }),

  // Disconnect an integration (clear tokens, set status = disconnected)
  disconnectIntegration: authedQuery
    .input(z.object({ provider: integrationProviderSchema }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const existing = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, input.provider),
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not connected." });
      }
      await db
        .update(assistantIntegrations)
        .set({
          status: "disconnected",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          lastError: null,
        })
        .where(eq(assistantIntegrations.id, existing.id));
      await logAudit(ctx, "update", "integration", String(existing.id), {
        provider: input.provider,
        action: "disconnected",
      });
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // Calendar — read events, create events, cancel events
  // ════════════════════════════════════════════════════════════════════

  // List calendar events for a date range. Tries the connected provider
  // first; falls back to local admin_assistant_calendar_events rows
  // (which include events the AI created).
  listCalendarEvents: authedQuery
    .input(
      z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const fromDate = input.from ? new Date(input.from) : new Date();
      const toDate = input.to
        ? new Date(input.to)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Local rows first (these are AI-created or owner-created)
      const local = await db.query.assistantCalendarEvents.findMany({
        where: and(
          eq(assistantCalendarEvents.tenantId, tenantId),
          gte(assistantCalendarEvents.startsAt, fromDate),
          lte(assistantCalendarEvents.startsAt, toDate),
        ),
        orderBy: [assistantCalendarEvents.startsAt],
        limit: input.limit,
      });

      // Then try the provider for external events
      const calInt = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "google_calendar"),
          eq(assistantIntegrations.status, "connected"),
        ),
      });
      const outlookInt = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "outlook_calendar"),
          eq(assistantIntegrations.status, "connected"),
        ),
      });
      const active = calInt ?? outlookInt;
      let external: typeof local = [];
      if (active) {
        const fetched = fetchCalendarEvents({
          provider: active.provider as IntegrationProvider,
          accessToken: active.accessToken ?? "",
          tenantId,
          fromDate,
          toDate,
        });
        external = fetched.map((e) => ({
          id: -1, // sentinel for "external" in the UI
          tenantId,
          source: "external" as const,
          contactId: null,
          callId: null,
          externalEventId: e.externalId,
          title: e.title,
          description: e.description ?? null,
          attendees: e.attendees.join(","),
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          timeZone: e.timeZone,
          meetingUrl: e.meetingUrl ?? null,
          status: "scheduled" as const,
          notes: null,
          phiClassification: "pii" as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      // Merge + sort by startsAt
      const merged = [...local, ...external].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      );
      await logAudit(ctx, "read", "calendar_events", null, { count: merged.length });
      return merged.slice(0, input.limit);
    }),

  // Create a calendar event on the owner's behalf (AI-driven).
  // If a calendar integration is connected, the event is pushed to the
  // provider AND mirrored locally. If not, only the local row is created
  // (and the UI shows a "connect Google Calendar to sync" banner).
  createCalendarEvent: authedQuery
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        timeZone: z.string().min(1).max(64).default("America/New_York"),
        attendees: z.array(z.string().email()).default([]),
        contactId: z.number().int().positive().optional(),
        callId: z.number().int().positive().optional(),
        notes: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (endsAt <= startsAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "endsAt must be after startsAt.",
        });
      }

      // Try to push to the provider first
      let externalId: string | undefined;
      let meetingUrl: string | undefined;
      const calInt = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "google_calendar"),
          eq(assistantIntegrations.status, "connected"),
        ),
      }) ?? await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "outlook_calendar"),
          eq(assistantIntegrations.status, "connected"),
        ),
      });
      if (calInt) {
        const created = createCalendarEvent({
          provider: calInt.provider as IntegrationProvider,
          accessToken: calInt.accessToken ?? "",
          tenantId,
          title: input.title,
          description: input.description,
          startsAt,
          endsAt,
          timeZone: input.timeZone,
          attendees: input.attendees,
        });
        externalId = created.externalId;
        meetingUrl = created.meetingUrl;
      }

      const inserted = await db
        .insert(assistantCalendarEvents)
        .values({
          tenantId,
          source: "ai_assistant",
          contactId: input.contactId ?? null,
          callId: input.callId ?? null,
          externalEventId: externalId ?? null,
          title: input.title,
          description: input.description ?? null,
          attendees: input.attendees.join(","),
          startsAt,
          endsAt,
          timeZone: input.timeZone,
          meetingUrl: meetingUrl ?? null,
          status: "scheduled",
          notes: input.notes ?? null,
          phiClassification: "pii",
        })
        .returning();

      await logAudit(ctx, "create", "calendar_event", String(inserted[0]?.id), {
        title: input.title,
        startsAt: startsAt.toISOString(),
        externalId,
      });
      return inserted[0];
    }),

  // Cancel a calendar event (only those the AI created — we never touch
  // external events we didn't author)
  cancelCalendarEvent: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const event = await db.query.assistantCalendarEvents.findFirst({
        where: and(
          eq(assistantCalendarEvents.id, input.id),
          eq(assistantCalendarEvents.tenantId, tenantId),
        ),
      });
      if (!event) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (event.source !== "ai_assistant" && event.source !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot cancel events from external sources.",
        });
      }
      await db
        .update(assistantCalendarEvents)
        .set({ status: "cancelled" })
        .where(eq(assistantCalendarEvents.id, input.id));
      await logAudit(ctx, "update", "calendar_event", String(input.id), {
        action: "cancelled",
      });
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // Email — read inbox, list drafts, approve draft, send
  // ════════════════════════════════════════════════════════════════════

  // List recent emails (read from provider if connected, else empty)
  listInbox: authedQuery
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const int = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "google_gmail"),
          eq(assistantIntegrations.status, "connected"),
        ),
      }) ?? await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "microsoft_graph"),
          eq(assistantIntegrations.status, "connected"),
        ),
      });
      if (!int) {
        return {
          connected: false,
          emails: [],
          message: "Connect Gmail or Outlook to see your inbox.",
        };
      }
      const emails = fetchInbox({
        provider: int.provider as IntegrationProvider,
        accessToken: int.accessToken ?? "",
        tenantId,
        unreadOnly: input.unreadOnly,
        limit: input.limit,
      });
      await logAudit(ctx, "read", "inbox", null, { count: emails.length, unreadOnly: input.unreadOnly });
      return { connected: true, emails, message: null };
    }),

  // List AI-drafted emails (pending owner review)
  listDrafts: authedQuery
    .input(
      z.object({
        status: z.enum(["draft", "approved", "sent", "rejected", "edited"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const conditions: any[] = [eq(assistantEmailDrafts.tenantId, tenantId)];
      if (input.status) {
        conditions.push(eq(assistantEmailDrafts.status, input.status));
      }
      return getDb().query.assistantEmailDrafts.findMany({
        where: and(...conditions),
        orderBy: [desc(assistantEmailDrafts.createdAt)],
        limit: input.limit,
      });
    }),

  // Approve a draft (mark approved, then send)
  approveDraft: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const draft = await db.query.assistantEmailDrafts.findFirst({
        where: and(
          eq(assistantEmailDrafts.id, input.id),
          eq(assistantEmailDrafts.tenantId, tenantId),
        ),
      });
      if (!draft) throw new TRPCError({ code: "NOT_FOUND" });
      if (draft.status === "sent") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already sent." });
      }

      // Try to send via the connected provider
      const int = await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "google_gmail"),
          eq(assistantIntegrations.status, "connected"),
        ),
      }) ?? await db.query.assistantIntegrations.findFirst({
        where: and(
          eq(assistantIntegrations.tenantId, tenantId),
          eq(assistantIntegrations.provider, "microsoft_graph"),
          eq(assistantIntegrations.status, "connected"),
        ),
      });
      let providerRef: string | undefined;
      if (int) {
        const sent = sendEmail({
          provider: int.provider as IntegrationProvider,
          accessToken: int.accessToken ?? "",
          to: draft.toAddr,
          subject: draft.subject,
          body: draft.body,
        });
        providerRef = sent.providerRef;
      } else {
        // No integration connected — mark as "approved" so the owner can
        // copy/paste it into their own mail client
      }
      await db
        .update(assistantEmailDrafts)
        .set({
          status: providerRef ? "sent" : "approved",
          sentAt: providerRef ? new Date() : null,
          providerRef: providerRef ?? null,
        })
        .where(eq(assistantEmailDrafts.id, input.id));
      await logAudit(ctx, "update", "email_draft", String(input.id), {
        action: providerRef ? "sent" : "approved",
        providerRef,
      });
      return { ok: true, providerRef };
    }),

  // Reject a draft
  rejectDraft: authedQuery
    .input(z.object({ id: z.number().int().positive(), reason: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const draft = await db.query.assistantEmailDrafts.findFirst({
        where: and(
          eq(assistantEmailDrafts.id, input.id),
          eq(assistantEmailDrafts.tenantId, tenantId),
        ),
      });
      if (!draft) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(assistantEmailDrafts)
        .set({ status: "rejected" })
        .where(eq(assistantEmailDrafts.id, input.id));
      await logAudit(ctx, "update", "email_draft", String(input.id), {
        action: "rejected",
        reason: input.reason,
      });
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // Calls — outbound tasks the AI placed on the owner's behalf
  // ════════════════════════════════════════════════════════════════════

  listCallTasks: authedQuery
    .input(
      z.object({
        status: z.enum([
          "pending", "scheduled", "placed", "completed", "failed", "cancelled",
        ]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const conditions: any[] = [eq(assistantCallTasks.tenantId, tenantId)];
      if (input.status) conditions.push(eq(assistantCallTasks.status, input.status));
      return getDb().query.assistantCallTasks.findMany({
        where: and(...conditions),
        orderBy: [desc(assistantCallTasks.createdAt)],
        limit: input.limit,
      });
    }),

  // Create a new call task. The owner can either place immediately
  // (scheduledFor = null) or schedule for a future time. The actual
  // placement is handled by a background worker (deferred) or can be
  // triggered manually via placeCallTask.
  createCallTask: authedQuery
    .input(
      z.object({
        toNumber: z.string().min(7).max(32),
        taskBrief: z.string().min(1).max(5000),
        contactId: z.number().int().positive().optional(),
        contactName: z.string().max(255).optional(),
        scheduledFor: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const scheduled = input.scheduledFor ? new Date(input.scheduledFor) : null;
      const inserted = await db
        .insert(assistantCallTasks)
        .values({
          tenantId,
          contactId: input.contactId ?? null,
          toNumber: input.toNumber,
          taskBrief: input.taskBrief,
          scheduledFor: scheduled,
          status: scheduled && scheduled > new Date() ? "scheduled" : "pending",
          phiClassification: "pii",
        })
        .returning();
      await logAudit(ctx, "create", "call_task", String(inserted[0]?.id), {
        toNumber: input.toNumber,
        scheduledFor: scheduled?.toISOString(),
      });
      return inserted[0];
    }),

  // Manually trigger placement of a pending call task. Bridges to FastAPI
  // like the sales vertical does. Returns the callSid from FastAPI.
  placeCallTask: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const task = await db.query.assistantCallTasks.findFirst({
        where: and(
          eq(assistantCallTasks.id, input.id),
          eq(assistantCallTasks.tenantId, tenantId),
        ),
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      if (!["pending", "scheduled", "failed"].includes(task.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Task is ${task.status}, cannot place.`,
        });
      }

      // Resolve the FastAPI bridge
      const cred = await getCredentialsForTenant(tenantId);
      if (!cred?.fastApiUrl || !cred?.fastApiAdminKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "FastAPI backend is not configured for this tenant.",
        });
      }

      try {
        const res = await callFastApiJson<{
          call_sid: string;
          status: string;
          from: string;
          call_id?: string;
        }>(
          { url: cred.fastApiUrl, adminKey: cred.fastApiAdminKey },
          "/call",
          {
            method: "POST",
            body: JSON.stringify({
              to: task.toNumber,
              purpose: "personal_assistant",
              lead_name: "",  // task doesn't carry a contactName field; use brief
              lead_context: task.taskBrief,
            }),
          },
        );

        // Mirror the call in admin_calls (same pattern as sales)
        const callIdRow = await db
          .insert(calls)
          .values({
            tenantId,
            callSid: res.call_sid,
            direction: "outbound",
            toNumber: task.toNumber,
            fromNumber: res.from ?? "",
            status: (res.status ?? "queued") as any,
            leadContext: task.taskBrief,
            phiClassification: "pii",
          })
          .onConflictDoNothing({ target: calls.callSid })
          .returning({ id: calls.id });

        await db
          .update(assistantCallTasks)
          .set({
            status: "placed",
            callId: callIdRow[0]?.id ?? task.callId,
          })
          .where(eq(assistantCallTasks.id, input.id));

        await logAudit(ctx, "update", "call_task", String(input.id), {
          action: "placed",
          callSid: res.call_sid,
        });
        return { callSid: res.call_sid, callId: callIdRow[0]?.id };
      } catch (e) {
        await db
          .update(assistantCallTasks)
          .set({ status: "failed" })
          .where(eq(assistantCallTasks.id, input.id));
        await logAudit(ctx, "update", "call_task", String(input.id), {
          action: "place_failed",
          error: String(e),
        });
        throw e;
      }
    }),

  // Cancel a pending/scheduled call task (before it gets placed)
  cancelCallTask: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const task = await db.query.assistantCallTasks.findFirst({
        where: and(
          eq(assistantCallTasks.id, input.id),
          eq(assistantCallTasks.tenantId, tenantId),
        ),
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      if (["completed", "placed", "cancelled"].includes(task.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Task is ${task.status}, cannot cancel.`,
        });
      }
      await db
        .update(assistantCallTasks)
        .set({ status: "cancelled" })
        .where(eq(assistantCallTasks.id, input.id));
      await logAudit(ctx, "update", "call_task", String(input.id), { action: "cancelled" });
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // Reminders — set, list, cancel
  // ════════════════════════════════════════════════════════════════════

  listReminders: authedQuery
    .input(
      z.object({
        status: z.enum(["active", "fired", "cancelled", "failed"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const conditions: any[] = [eq(assistantReminders.tenantId, tenantId)];
      if (input.status) conditions.push(eq(assistantReminders.status, input.status));
      return getDb().query.assistantReminders.findMany({
        where: and(...conditions),
        orderBy: [assistantReminders.fireAt],
        limit: input.limit,
      });
    }),

  createReminder: authedQuery
    .input(
      z.object({
        message: z.string().min(1).max(1000),
        fireAt: z.string().datetime(),
        channel: z.enum(["sms", "call", "email"]),
        destination: z.string().min(3).max(320),
        contactId: z.number().int().positive().optional(),
        callId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const fireAt = new Date(input.fireAt);
      if (fireAt <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "fireAt must be in the future.",
        });
      }
      const inserted = await db
        .insert(assistantReminders)
        .values({
          tenantId,
          contactId: input.contactId ?? null,
          callId: input.callId ?? null,
          message: input.message,
          channel: input.channel,
          destination: input.destination,
          fireAt,
          status: "active",
          phiClassification: "pii",
        })
        .returning();
      await logAudit(ctx, "create", "reminder", String(inserted[0]?.id), {
        fireAt: fireAt.toISOString(),
        channel: input.channel,
      });
      return inserted[0];
    }),

  cancelReminder: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const reminder = await db.query.assistantReminders.findFirst({
        where: and(
          eq(assistantReminders.id, input.id),
          eq(assistantReminders.tenantId, tenantId),
        ),
      });
      if (!reminder) throw new TRPCError({ code: "NOT_FOUND" });
      if (reminder.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Reminder is ${reminder.status}, cannot cancel.`,
        });
      }
      await db
        .update(assistantReminders)
        .set({ status: "cancelled" })
        .where(eq(assistantReminders.id, input.id));
      await logAudit(ctx, "update", "reminder", String(input.id), { action: "cancelled" });
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // Contact memory — notes the AI keeps about people
  // ════════════════════════════════════════════════════════════════════

  listContactNotes: authedQuery
    .input(
      z.object({
        contactId: z.number().int().positive().optional(),
        category: z.string().max(32).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const conditions: any[] = [eq(assistantContactNotes.tenantId, tenantId)];
      if (input.contactId) conditions.push(eq(assistantContactNotes.contactId, input.contactId));
      if (input.category) conditions.push(eq(assistantContactNotes.category, input.category));
      return getDb().query.assistantContactNotes.findMany({
        where: and(...conditions),
        orderBy: [desc(assistantContactNotes.createdAt)],
        limit: input.limit,
      });
    }),

  appendContactNote: authedQuery
    .input(
      z.object({
        contactId: z.number().int().positive(),
        note: z.string().min(1).max(5000),
        category: z.enum([
          "preference", "family", "health_context", "general", "other",
        ]).default("general"),
        source: z.enum(["call", "manual", "ai_summary"]).default("manual"),
        callId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      // Verify the contact belongs to this tenant
      const contact = await db.query.contacts.findFirst({
        where: and(
          eq(contacts.id, input.contactId),
          eq(contacts.tenantId, tenantId),
        ),
      });
      if (!contact) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contact not found.",
        });
      }

      const inserted = await db
        .insert(assistantContactNotes)
        .values({
          tenantId,
          contactId: input.contactId,
          note: input.note,
          category: input.category,
          source: input.source,
          callId: input.callId ?? null,
          phiClassification:
            input.category === "health_context" ? "phi" : "pii",
        })
        .returning();
      await logAudit(ctx, "create", "contact_note", String(inserted[0]?.id), {
        contactId: input.contactId,
        category: input.category,
      });
      return inserted[0];
    }),

  deleteContactNote: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const note = await db.query.assistantContactNotes.findFirst({
        where: and(
          eq(assistantContactNotes.id, input.id),
          eq(assistantContactNotes.tenantId, tenantId),
        ),
      });
      if (!note) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .delete(assistantContactNotes)
        .where(eq(assistantContactNotes.id, input.id));
      await logAudit(ctx, "delete", "contact_note", String(input.id), {});
      return { ok: true };
    }),

  // ════════════════════════════════════════════════════════════════════
  // OAuth callback (for the mock provider flow)
  // ════════════════════════════════════════════════════════════════════

  // This is a regular HTTP endpoint, NOT a tRPC procedure. The OAuth
  // callback URL is hit by the browser after the mock provider flow.
  // It completes the integration by exchanging the state for tokens
  // and marking the integration as connected.
  //
  // Note: this is registered as a separate route in api/router.ts, not
  // here. The tRPC procedure above is for the start of the flow; the
  // callback is a standard Express-style handler.
});
