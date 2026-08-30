// Tenants router — for the owner to see and edit tenant info.
// In the MVP, this is read-only (the seed creates tenant 1 and we don't
// allow self-serve onboarding yet). Future: invite a team member, transfer
// ownership, change compliance tier, etc.

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenants, auditLog } from "@db/schema";

function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

export const tenantsRouter = createRouter({
  // Get the current tenant's info
  current: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    const tenant = await getDb().query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });
    return tenant;
  }),

  // Update brand info on the current tenant
  updateBrand: authedQuery
    .input(
      z.object({
        brandName: z.string().min(1).max(255).optional(),
        brandDomain: z.string().max(255).optional().nullable(),
        brandPhone: z.string().max(32).optional().nullable(),
        brandEmail: z.string().email().max(320).optional().nullable(),
        brandLegalName: z.string().max(255).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length === 0) return { ok: true };

      await db.update(tenants).set(cleaned).where(eq(tenants.id, tenantId));

      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "update",
        resourceType: "tenant",
        resourceId: String(tenantId),
        details: { changed: Object.keys(cleaned) },
      });

      return { ok: true };
    }),

  // List recent audit log entries for the current tenant
  auditLog: authedQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        resourceType: z.string().max(64).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const conditions: any[] = [eq(auditLog.tenantId, tenantId)];
      if (input.resourceType) {
        const { and, eq: eqq } = await import("drizzle-orm");
        conditions.push(eqq(auditLog.resourceType, input.resourceType));
        return getDb().query.auditLog.findMany({
          where: and(...conditions),
          orderBy: (a, { desc }) => [desc(a.createdAt)],
          limit: input.limit,
        });
      }
      return getDb().query.auditLog.findMany({
        where: conditions[0],
        orderBy: (a, { desc }) => [desc(a.createdAt)],
        limit: input.limit,
      });
    }),
});
