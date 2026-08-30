// Per-tenant credentials (Twilio, SMTP, WS gateway, FastAPI backend).
//
// In the multi-tenant model, every row is scoped to a tenant, not a user.
// Twilio creds in particular are per-tenant — each tenant has their own
// Twilio account (or shares the platform account, but the row is per-tenant).

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { credentials } from "@db/schema";
import { twilioTestCredentials, type TwilioCreds } from "./services/twilio";
import { testSmtp } from "./services/email";

function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

export async function getCredentialsForTenant(tenantId: number) {
  const row = await getDb().query.credentials.findFirst({
    where: eq(credentials.tenantId, tenantId),
  });
  return row ?? null;
}

export function requireTwilio(cred: Awaited<ReturnType<typeof getCredentialsForTenant>>): TwilioCreds {
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
  fastApiUrl: z.string().max(512).optional().nullable(),
  fastApiAdminKey: z.string().max(128).optional().nullable(),
});

export const credentialsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    const c = await getCredentialsForTenant(tenantId);
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
      fastApiUrl: c.fastApiUrl,
      hasFastApiKey: Boolean(c.fastApiAdminKey),
    };
  }),

  save: authedQuery.input(credsInput).mutation(async ({ ctx, input }) => {
    const tenantId = requireTenantId(ctx);
    const db = getDb();
    const existing = await getCredentialsForTenant(tenantId);
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      // null/undefined/"" = "keep existing" for secrets; explicit value overwrites
      if (v !== undefined && v !== null && v !== "") merged[k] = v;
    }
    if (existing) {
      await db.update(credentials).set(merged).where(eq(credentials.tenantId, tenantId));
    } else {
      await db.insert(credentials).values({ tenantId, ...merged });
    }
    return { ok: true };
  }),

  testTwilio: authedQuery.mutation(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    const cred = await getCredentialsForTenant(tenantId);
    const t = requireTwilio(cred);
    return twilioTestCredentials(t);
  }),

  testSmtp: authedQuery.mutation(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    const cred = await getCredentialsForTenant(tenantId);
    if (!cred?.smtpHost || !cred.smtpPort || !cred.smtpUser || !cred.smtpPass || !cred.smtpFrom) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "SMTP is not fully configured." });
    }
    return testSmtp({
      host: cred.smtpHost, port: cred.smtpPort, user: cred.smtpUser,
      pass: cred.smtpPass, from: cred.smtpFrom,
    });
  }),
});
