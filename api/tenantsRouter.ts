// Tenants router — for the owner to see and edit tenant info.
// In the MVP, this is read-only (the seed creates tenant 1 and we don't
// allow self-serve onboarding yet). Future: invite a team member, transfer
// ownership, change compliance tier, etc.
//
// `listForPreview` is owner-only: returns the full list of tenants so the
// owner can pick one to preview via the sidebar tenant switcher.

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
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

function requireOwner(ctx: any): void {
  if (ctx.user?.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This action is for platform owners only.",
    });
  }
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

  // List all tenants (owner-only). Used by the tenant switcher to populate
  // the dropdown of preview targets.
  listForPreview: authedQuery.query(async ({ ctx }) => {
    requireOwner(ctx);
    const rows = await getDb().query.tenants.findMany({
      orderBy: [asc(tenants.name)],
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      brandName: t.brandName,
      complianceTier: t.complianceTier,
    }));
  }),

  // Return the current "viewing as" state. The frontend reads this to
  // render the "Previewing as <name>" banner + the Exit Preview button.
  viewingAs: authedQuery.query(async ({ ctx }) => {
    if (!ctx.user) {
      return { ownerEmail: null, isOwner: false, isPreviewing: false, target: null };
    }
    const isOwner = ctx.user.role === "owner";
    const isPreviewing = !!ctx.previewTenantId;
    let target: { id: number; name: string; brandName: string } | null = null;
    if (isPreviewing && ctx.tenant) {
      target = {
        id: ctx.tenant.id,
        name: ctx.tenant.name,
        brandName: ctx.tenant.brandName,
      };
    }
    return {
      ownerEmail: isOwner ? ctx.user.email : null,
      isOwner,
      isPreviewing,
      target,
      ownTenantId: ctx.user.defaultTenantId,
    };
  }),
});
