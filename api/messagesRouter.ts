import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { contacts, messages } from "@db/schema";
import { getCredentialsForUser, requireTwilio } from "./credentialsRouter";
import { twilioSendSms, twilioSendWhatsApp } from "./services/twilio";
import { sendEmail } from "./services/email";

const E164 = /^\+[1-9]\d{7,14}$/;

export const messagesRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb().query.messages.findMany({
      where: eq(messages.userId, ctx.user.id),
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
      const db = getDb();
      const cred = await getCredentialsForUser(ctx.user.id);
      let providerRef = "";
      let status = "sent";
      let error: string | null = null;

      try {
        if (input.channel === "whatsapp" || input.channel === "sms") {
          if (!E164.test(input.to)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Phone must be E.164, e.g. +15551234567" });
          }
          // DNC enforcement for phone channels
          const contact = await db.query.contacts.findFirst({
            where: and(eq(contacts.userId, ctx.user.id), eq(contacts.phone, input.to)),
          });
          if (contact?.dnc) {
            throw new TRPCError({ code: "FORBIDDEN", message: "This number is on your Do-Not-Call list." });
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

      const ins = await db.insert(messages).values({
        userId: ctx.user.id,
        channel: input.channel,
        toAddr: input.to,
        subject: input.subject ?? null,
        body: input.body,
        status,
        providerRef: providerRef || null,
        error,
      });

      if (status === "failed") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Send failed: ${error}` });
      }
      return { id: Number(ins[0].insertId), status, providerRef };
    }),
});

export const contactsRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    return getDb().query.contacts.findMany({
      where: eq(contacts.userId, ctx.user.id),
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
      const db = getDb();
      if (input.id) {
        await db
          .update(contacts)
          .set({ name: input.name, phone: input.phone, email: input.email ?? null, tags: input.tags ?? null })
          .where(and(eq(contacts.id, input.id), eq(contacts.userId, ctx.user.id)));
        return { id: input.id };
      }
      const r = await db.insert(contacts).values({
        userId: ctx.user.id,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        tags: input.tags ?? null,
      });
      return { id: Number(r[0].insertId) };
    }),

  setDnc: authedQuery
    .input(z.object({ id: z.number(), dnc: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await getDb()
        .update(contacts)
        .set({ dnc: input.dnc })
        .where(and(eq(contacts.id, input.id), eq(contacts.userId, ctx.user.id)));
      return { ok: true };
    }),

  remove: authedQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    await getDb().delete(contacts).where(and(eq(contacts.id, input.id), eq(contacts.userId, ctx.user.id)));
    return { ok: true };
  }),
});
