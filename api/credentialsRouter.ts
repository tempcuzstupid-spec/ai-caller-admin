import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { credentials } from "@db/schema";
import { twilioTestCredentials, type TwilioCreds } from "./services/twilio";
import { testSmtp } from "./services/email";

export async function getCredentialsForUser(userId: number) {
  const db = getDb();
  const row = await db.query.credentials.findFirst({
    where: eq(credentials.userId, userId),
  });
  return row ?? null;
}

export function requireTwilio(cred: Awaited<ReturnType<typeof getCredentialsForUser>>): TwilioCreds {
  if (!cred?.twilioAccountSid || !cred.twilioAuthToken || !cred.twilioPhoneNumber) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Twilio is not configured. Add your Account SID, Auth Token, and phone number in Settings.",
    });
  }
  return {
    accountSid: cred.twilioAccountSid,
    authToken: cred.twilioAuthToken,
    phoneNumber: cred.twilioPhoneNumber,
    whatsappNumber: cred.twilioWhatsappNumber,
  };
}

const credsInput = z.object({
  twilioAccountSid: z.string().max(128).optional().nullable(),
  twilioAuthToken: z.string().max(128).optional().nullable(),
  twilioPhoneNumber: z.string().max(32).optional().nullable(),
  twilioWhatsappNumber: z.string().max(32).optional().nullable(),
  smtpHost: z.string().max(255).optional().nullable(),
  smtpPort: z.number().int().min(1).max(65535).optional().nullable(),
  smtpUser: z.string().max(255).optional().nullable(),
  smtpPass: z.string().max(255).optional().nullable(),
  smtpFrom: z.string().max(255).optional().nullable(),
  wsGatewayUrl: z.string().max(512).optional().nullable(),
  conversationWsToken: z.string().max(128).optional().nullable(),
});

export const credentialsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const c = await getCredentialsForUser(ctx.user.id);
    if (!c) return null;
    // Never return secrets to the client — only whether they're set.
    return {
      twilioAccountSid: c.twilioAccountSid,
      twilioPhoneNumber: c.twilioPhoneNumber,
      twilioWhatsappNumber: c.twilioWhatsappNumber,
      hasTwilioAuthToken: Boolean(c.twilioAuthToken),
      smtpHost: c.smtpHost,
      smtpPort: c.smtpPort,
      smtpUser: c.smtpUser,
      smtpFrom: c.smtpFrom,
      hasSmtpPass: Boolean(c.smtpPass),
      wsGatewayUrl: c.wsGatewayUrl,
      hasWsToken: Boolean(c.conversationWsToken),
    };
  }),

  save: authedQuery.input(credsInput).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const existing = await getCredentialsForUser(ctx.user.id);
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      // null/undefined/"" = "keep existing" for secrets; explicit value overwrites
      if (v !== undefined && v !== null && v !== "") merged[k] = v;
    }
    if (existing) {
      await db.update(credentials).set(merged).where(eq(credentials.userId, ctx.user.id));
    } else {
      await db.insert(credentials).values({ userId: ctx.user.id, ...merged });
    }
    return { ok: true };
  }),

  testTwilio: authedQuery.mutation(async ({ ctx }) => {
    const cred = await getCredentialsForUser(ctx.user.id);
    const t = requireTwilio(cred);
    return twilioTestCredentials(t);
  }),

  testSmtp: authedQuery.mutation(async ({ ctx }) => {
    const cred = await getCredentialsForUser(ctx.user.id);
    if (!cred?.smtpHost || !cred.smtpPort || !cred.smtpUser || !cred.smtpPass || !cred.smtpFrom) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SMTP is not fully configured." });
    }
    return testSmtp({
      host: cred.smtpHost, port: cred.smtpPort, user: cred.smtpUser,
      pass: cred.smtpPass, from: cred.smtpFrom,
    });
  }),
});
