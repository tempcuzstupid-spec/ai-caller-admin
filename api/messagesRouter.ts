// Messages + contacts routers — multi-tenant aware.
//
// Both filter on tenant_id. DNC enforcement at the API layer for phone channels.

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { contacts, messages } from "@db/schema";
import { getCredentialsForTenant, requireTwilio } from "./credentialsRouter";
import { twilioSendSms, twilioSendWhatsApp } from "./services/twilio";
import { sendEmail } from "./services/email";

const E164 = /^\+[1-9]\d{7,14}$/;

function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

export const messagesRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    return getDb().query.messages.findMany({
      where: eq(messages.tenantId, tenantId),
      orderBy: [desc(messages.createdAt)],
      limit: 100,
    });
  }),

  send: authedQuery
    .input(
      z.object({
        channel: z.enum(["whatsapp", "email", "sms"]),
        to: z.string().min(3).max(320),
        subject: z.string().max(255).optional(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const cred = await getCredentialsForTenant(tenantId);
      let providerRef = "";
      let status: "sent" | "failed" = "sent";
      let error: string | null = null;

      try {
        if (input.channel === "whatsapp" || input.channel === "sms") {
          if (!E164.test(input.to)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Phone must be E.164, e.g. +15551234567" });
          }
          // DNC enforcement at the API layer
          const contact = await db.query.contacts.findFirst({
            where: and(eq(contacts.tenantId, tenantId), eq(contacts.phone, input.to)),
          });
          if (contact?.dnc) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This number is on the Do-Not-Call list for this tenant." });
          }
          const twilio = requireTwilio(cred);
          const res =
            input.channel === "whatsapp"
              ? await twilioSendWhatsApp(twilio, input.to, input.body)
              : await twilioSendSms(twilio, input.to, input.body);
          providerRef = res.sid;
        } else {
          if (!cred?.smtpHost || !cred.smtpPort || !cred.smtpUser || !cred.smtpPass || !cred.smtpFrom) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Email is not configured. Add SMTP settings in Settings.",
            });
          }
          const res = await sendEmail(
            { host: cred.smtpHost, port: cred.smtpPort, user: cred.smtpUser, pass: cred.smtpPass, from: cred.smtpFrom },
            { to: input.to, subject: input.subject || "(no subject)", body: input.body },
          );
          providerRef = res.messageId;
        }
      } catch (e: any) {
        if (e instanceof TRPCError) throw e;
        status = "failed";
        error = String(e?.message || e).slice(0, 1000);
      }

      const inserted = await db
        .insert(messages)
        .values({
          tenantId,
          channel: input.channel,
          toAddr: input.to,
          subject: input.subject ?? null,
          body: input.body,
          status,
          providerRef: providerRef || null,
          error,
        })
        .returning({ id: messages.id });

      if (status === "failed") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Send failed: ${error}` });
      }
      return { id: inserted[0].id, status, providerRef };
    }),
});

export const contactsRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    return getDb().query.contacts.findMany({
      where: eq(contacts.tenantId, tenantId),
      orderBy: [desc(contacts.createdAt)],
      limit: 500,
    });
  }),

  upsert: authedQuery
    .input(
      z.object({
        id: z.number().optional(),
        name: z.string().min(1).max(120),
        phone: z.string().regex(E164, "Phone must be E.164"),
        email: z.string().email().max(320).optional().nullable(),
        tags: z.string().max(255).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      if (input.id) {
        await db
          .update(contacts)
          .set({ name: input.name, phone: input.phone, email: input.email ?? null, tags: input.tags ?? null })
          .where(and(eq(contacts.id, input.id), eq(contacts.tenantId, tenantId)));
        return { id: input.id };
      }
      const inserted = await db
        .insert(contacts)
        .values({
          tenantId,
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          tags: input.tags ?? null,
        })
        .returning({ id: contacts.id });
      return { id: inserted[0].id };
    }),

  setDnc: authedQuery
    .input(z.object({ id: z.number(), dnc: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      await getDb()
        .update(contacts)
        .set({ dnc: input.dnc })
        .where(and(eq(contacts.id, input.id), eq(contacts.tenantId, tenantId)));
      return { ok: true };
    }),

  remove: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenantId(ctx);
    await getDb().delete(contacts).where(and(eq(contacts.id, input.id), eq(contacts.tenantId, tenantId)));
    return { ok: true };
  }),
});
