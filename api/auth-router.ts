import * as cookie from "cookie";
import * as jose from "jose";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, tenants, auditLog } from "@db/schema";
import { env } from "./lib/env";

// Sign a session JWT (mirrors the Kimi one but is independent of Kimi).
async function signLocalSession(unionId: string): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT({ unionId, clientId: env.appId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1 year")
    .sign(secret);
}

// Dev login — creates a user + ensures a tenant exists + sets the session cookie.
// This is the "I don't want to set up Kimi OAuth right now" path. Disabled in
// production unless DEV_LOGIN=1 is explicitly set.

const devLoginInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  tenantSlug: z.string().min(1).max(64).optional(),
});

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),

  // Dev login: post { email, name, tenantSlug? } and get a session cookie back.
  // Disabled in production unless DEV_LOGIN=1.
  devLogin: publicQuery
    .input(devLoginInput)
    .mutation(async ({ ctx, input }) => {
      if (env.isProduction && process.env.DEV_LOGIN !== "1") {
        throw new Error("Dev login is disabled in production");
      }

      const db = getDb();
      const unionId = `dev-${input.email}`;
      const tenantSlug = input.tenantSlug ?? "premium-meridian";

      // Find or create the tenant
      let tenant = await db.query.tenants.findFirst({
        where: eq(tenants.slug, tenantSlug),
      });
      if (!tenant) {
        const inserted = await db
          .insert(tenants)
          .values({
            name: "Premium Meridian",
            slug: tenantSlug,
            brandName: "Premium Meridian",
            brandDomain: "premiummeridian.org",
            brandPhone: "+13868438160",
            brandEmail: "management@premiummeridian.org",
            brandLegalName: "Premium Meridian LLC",
            complianceTier: "hipaa",
          })
          .returning();
        tenant = inserted[0];
      }

      // Upsert the user
      const role = input.email === process.env.OWNER_EMAIL ? "owner" : "admin";
      const userValues = {
        unionId,
        name: input.name,
        email: input.email,
        defaultTenantId: tenant.id,
        role: role as "user" | "admin" | "owner",
      };
      const inserted = await db
        .insert(users)
        .values(userValues as any)
        .onConflictDoUpdate({
          target: users.unionId,
          set: {
            name: input.name,
            email: input.email,
            defaultTenantId: tenant.id,
            // Re-evaluate role on every dev login so that setting OWNER_EMAIL
            // after the user was first created promotes them to owner. (We
            // don't want to demote a real owner if OWNER_EMAIL is unset —
            // only promote when the email matches the configured owner.)
            ...(process.env.OWNER_EMAIL && input.email === process.env.OWNER_EMAIL
              ? { role: "owner" as const }
              : {}),
            lastSignInAt: new Date(),
          },
        })
        .returning();
      const user = inserted[0];

      await db.insert(auditLog).values({
        tenantId: tenant.id,
        actorUserId: user.id,
        action: "login",
        resourceType: "user",
        resourceId: String(user.id),
        details: { method: "dev_login" },
      });

      // Set the session cookie
      const token = await signLocalSession(unionId);
      const cookieOpts = getSessionCookieOptions(ctx.req.headers);
      ctx.resHeaders.append(
        "set-cookie",
        cookie.serialize(Session.cookieName, token, {
          httpOnly: cookieOpts.httpOnly,
          path: cookieOpts.path,
          sameSite: cookieOpts.sameSite?.toLowerCase() as "lax" | "none",
          secure: cookieOpts.secure,
          maxAge: Session.maxAgeMs / 1000,
        }),
      );

      return { user, tenant };
    }),
});
