// AI agents router — multi-tenant aware.
//
// In the old single-tenant version, "agents" was a flat table owned by a user.
// In the multi-tenant version, an "agent config" is a join between a tenant
// and a vertical, with optional overrides (system prompt, voice, opening
// line, catalog). The 5 general + 7 industry verticals live in
// contracts/catalog.ts as templates; this router manages the per-tenant
// instances.

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { agentConfigs, verticals } from "@db/schema";
import { AGENT_CATEGORIES, STARTER_VERTICAL_IDS } from "@contracts/catalog";
import { auditLog, tenants } from "@db/schema";

const agentConfigInput = z.object({
  verticalId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  systemPromptOverride: z.string().max(20000).optional().nullable(),
  openingLineOverride: z.string().max(2000).optional().nullable(),
  voiceId: z.string().max(64).default("TxGEqnHWrfWFTfGW9XjX"),
  model: z.string().max(64).default("gpt-4o-mini"),
  fromNumbers: z.string().max(1000).optional().nullable(),
  handoffNumber: z.string().max(32).optional().nullable(),
  catalog: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        description: z.string(),
        priceUsd: z.number(),
        category: z.string(),
      })
    )
    .optional()
    .default([]),
  complianceTier: z.enum(["basic", "hipaa"]).default("basic"),
  twilioVoiceWebhookUrl: z.string().max(512).optional().nullable(),
  twilioSmsWebhookUrl: z.string().max(512).optional().nullable(),
  twilioStatusCallbackUrl: z.string().max(512).optional().nullable(),
  active: z.boolean().default(true),
});

const agentConfigUpdate = agentConfigInput.partial().extend({
  id: z.number().int().positive(),
});

// Helper: resolve the current tenant from context.
function requireTenantId(ctx: any): number {
  if (!ctx.tenant?.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No tenant context" });
  }
  return ctx.tenant.id;
}

export const agentsRouter = createRouter({
  // ── Templates (vertical starters) ───────────────────────────────
  templates: authedQuery.query(() => AGENT_CATEGORIES),

  starterVerticalIds: authedQuery.query(() => STARTER_VERTICAL_IDS),

  // ── List verticals available to this tenant ────────────────────
  listVerticals: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    // Return both platform-level verticals (owner_tenant_id = NULL) and
    // tenant-specific clones.
    return getDb().query.verticals.findMany({
      where: (v, { eq, or, isNull, and }) =>
        or(isNull(v.ownerTenantId), eq(v.ownerTenantId, tenantId)),
      orderBy: [desc(verticals.updatedAt)],
    });
  }),

  // ── List agent configs (the tenant's deployed agents) ──────────
  list: authedQuery.query(async ({ ctx }) => {
    const tenantId = requireTenantId(ctx);
    return getDb().query.agentConfigs.findMany({
      where: eq(agentConfigs.tenantId, tenantId),
      orderBy: [desc(agentConfigs.updatedAt)],
    });
  }),

  get: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const row = await getDb().query.agentConfigs.findFirst({
        where: and(eq(agentConfigs.id, input.id), eq(agentConfigs.tenantId, tenantId)),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  // ── Create an agent config (instantiate a vertical for the tenant) ──
  create: authedQuery
    .input(agentConfigInput)
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      // Verify the vertical exists and is accessible to this tenant
      const vertical = await db.query.verticals.findFirst({
        where: (v, { eq, and, or, isNull }) =>
          and(
            eq(v.id, input.verticalId),
            or(isNull(v.ownerTenantId), eq(v.ownerTenantId, tenantId))
          ),
      });
      if (!vertical) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vertical not found" });
      }

      const r = await db
        .insert(agentConfigs)
        .values({
          ...input,
          tenantId,
        })
        .returning({ id: agentConfigs.id });

      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "create",
        resourceType: "agent_config",
        resourceId: String(r[0].id),
        details: { name: input.name, verticalId: input.verticalId },
      });

      return { id: r[0].id };
    }),

  update: authedQuery
    .input(agentConfigUpdate)
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const { id, ...data } = input;
      const db = getDb();

      const res = await db
        .update(agentConfigs)
        .set(data)
        .where(and(eq(agentConfigs.id, id), eq(agentConfigs.tenantId, tenantId)))
        .returning({ id: agentConfigs.id });

      if (res.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "update",
        resourceType: "agent_config",
        resourceId: String(id),
        details: data,
      });

      return { ok: true };
    }),

  remove: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      const res = await db
        .delete(agentConfigs)
        .where(and(eq(agentConfigs.id, input.id), eq(agentConfigs.tenantId, tenantId)))
        .returning({ id: agentConfigs.id });

      if (res.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await db.insert(auditLog).values({
        tenantId,
        actorUserId: ctx.user?.id,
        action: "delete",
        resourceType: "agent_config",
        resourceId: String(input.id),
      });

      return { ok: true };
    }),

  // ── Clone a platform-level vertical into the tenant's namespace ──
  cloneVertical: authedQuery
    .input(z.object({ verticalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = requireTenantId(ctx);
      const db = getDb();

      const source = await db.query.verticals.findFirst({
        where: (v, { eq, and, or, isNull }) =>
          and(
            eq(v.id, input.verticalId),
            or(isNull(v.ownerTenantId), eq(v.ownerTenantId, tenantId))
          ),
      });
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const r = await db
        .insert(verticals)
        .values({
          ownerTenantId: tenantId,
          category: source.category,
          name: `${source.name} (Custom)`,
          description: source.description,
          visibility: "private",
          defaultComplianceTier: source.defaultComplianceTier,
        })
        .returning({ id: verticals.id });

      return { id: r[0].id };
    }),
});
