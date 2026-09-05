import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { credentialsRouter } from "./credentialsRouter";
import { agentsRouter } from "./agentsRouter";
import { callsRouter } from "./callsRouter";
import { messagesRouter, contactsRouter } from "./messagesRouter";
import { tenantsRouter } from "./tenantsRouter";
import { assistantRouter } from "./assistantRouter";
import { getDb } from "./queries/connection";
import { auditLog, assistantIntegrations } from "@db/schema";
import { completeOAuthFlow, type IntegrationProvider } from "./lib/assistantIntegrations";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  credentials: credentialsRouter,
  agents: agentsRouter,
  calls: callsRouter,
  messages: messagesRouter,
  contacts: contactsRouter,
  tenants: tenantsRouter,
  assistant: assistantRouter,
});

export type AppRouter = typeof appRouter;

// ── OAuth callback routes (not tRPC, plain HTTP) ────────────────────────
// These handle the redirect from the OAuth provider (or the mock provider).
// In production with real Google, this would validate the `code` param
// and exchange it for tokens. In mock mode, we just complete immediately.

export const oauthCallbackRoutes = new Hono();

const providerSchema = z.enum([
  "google_calendar",
  "outlook_calendar",
  "google_gmail",
  "microsoft_graph",
]);

// The callback URL the user is redirected to. For mock, we just complete
// the integration immediately and bounce them back to the assistant page.
oauthCallbackRoutes.get("/integrations/callback", async (c) => {
  const provider = providerSchema.safeParse(c.req.query("provider"));
  const state = c.req.query("state");
  const mock = c.req.query("mock");

  if (!provider.success) {
    return c.text("Invalid provider.", 400);
  }
  if (!state) {
    return c.text("Missing state.", 400);
  }

  // Pull session info from the cookie. We parse the raw Cookie header
  // directly because Hono's c.req.cookie() requires the Cookie type
  // to be wired up in the Bindings (not done here to keep imports minimal).
  const rawCookie = c.req.header("cookie") ?? "";
  const sessionCookie = rawCookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("vr_session="))
    ?.slice("vr_session=".length);
  if (!sessionCookie) {
    return c.redirect("/login?error=oauth_no_session");
  }

  // Decode the session JWT to get the unionId
  let unionId: string | undefined;
  try {
    const parts = sessionCookie.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(
        Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      unionId = payload.unionId;
    }
  } catch {
    return c.redirect("/login?error=oauth_bad_session");
  }
  if (!unionId) {
    return c.redirect("/login?error=oauth_no_unionid");
  }

  // Look up the user + tenant
  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq((await import("@db/schema")).users.unionId, unionId),
  });
  if (!user?.defaultTenantId) {
    return c.redirect("/login?error=oauth_no_tenant");
  }
  const tenantId = user.defaultTenantId;

  // Find the integration row (must be in pending state with matching state)
  const integration = await db.query.assistantIntegrations.findFirst({
    where: and(
      eq(assistantIntegrations.tenantId, tenantId),
      eq(assistantIntegrations.provider, provider.data),
    ),
  });
  if (!integration) {
    return c.text("Integration not found.", 404);
  }

  // For real OAuth, we'd exchange `code` for tokens here. For mock, we
  // just complete immediately.
  let tokens;
  if (mock) {
    tokens = completeOAuthFlow({
      provider: provider.data as IntegrationProvider,
      tenantId,
      state,
    });
  } else {
    return c.text("Real OAuth flow not yet wired up. Use mock for now.", 501);
  }

  // Update the integration with the tokens + mark connected
  await db
    .update(assistantIntegrations)
    .set({
      status: "connected",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      externalUserId: tokens.externalUserId,
      externalUserEmail: tokens.externalUserEmail,
      lastSyncedAt: new Date(),
      lastError: null,
    })
    .where(eq(assistantIntegrations.id, integration.id));

  // Audit log
  await db.insert(auditLog).values({
    tenantId,
    actorUserId: user.id,
    action: "update",
    resourceType: "integration",
    resourceId: String(integration.id),
    details: { provider: provider.data, action: "connected" },
  });

  // Bounce back to the assistant page
  return c.redirect("/assistant?connected=" + provider.data);
});
