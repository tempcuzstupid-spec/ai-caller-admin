// tRPC context — resolves the authenticated user AND their current tenant.
//
// On every request, after Kimi auth gives us a User, we look up their
// defaultTenantId and load the Tenant row into ctx.tenant. Every tenant-scoped
// router reads ctx.tenant.id and filters on it.
//
// Owner "preview as tenant" mode:
//   - When the user is role=owner AND the request includes an
//     `X-Preview-Tenant: <tenantId>` header, we override ctx.tenant with that
//     target tenant. The owner sees the dashboard exactly as the target tenant
//     would see it. Useful for support, debugging, sales demos.
//   - We also log every preview switch to the audit log so the target tenant
//     has a record of the owner viewing their data.
//   - `ctx.previewTenantId` is set to the target tenant id; `ctx.actingAsOwner`
//     is true while previewing, false otherwise. Routers can use these to add
//     a "Previewing as <tenant>" banner to responses or skip destructive ops.

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User, Tenant } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { tenants as tenantsTable, auditLog } from "@db/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  tenant?: Tenant;
  // Set when the owner is previewing another tenant. ctx.tenant is overridden
  // to point at the target tenant in this case.
  previewTenantId?: number;
  // True iff ctx.tenant is the user's default tenant AND no preview is active.
  actingAsOwner?: boolean;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = {
    req: opts.req,
    resHeaders: opts.resHeaders,
    actingAsOwner: true, // default; flipped to false if user ends up previewing
  };
  try {
    const user = await authenticateRequest(opts.req.headers);
    ctx.user = user;

    // Default tenant: the user's own.
    let activeTenant: Tenant | undefined;
    if (user.defaultTenantId) {
      activeTenant = await getDb().query.tenants.findFirst({
        where: eq(tenantsTable.id, user.defaultTenantId),
      });
    }

    // Owner preview: header X-Preview-Tenant: <tenantId> overrides the default.
    const previewHeader = opts.req.headers.get("x-preview-tenant");
    if (previewHeader && user.role === "owner") {
      const targetId = parseInt(previewHeader, 10);
      if (Number.isFinite(targetId) && targetId > 0 && targetId !== user.defaultTenantId) {
        const target = await getDb().query.tenants.findFirst({
          where: eq(tenantsTable.id, targetId),
        });
        if (target) {
          // Best-effort audit log: tell the target tenant that the owner
          // started viewing their dashboard. Don't fail the request if the
          // log write errors (e.g. the audit_log table isn't migrated yet).
          try {
            await getDb().insert(auditLog).values({
              tenantId: target.id,
              actorUserId: user.id,
              action: "preview",
              resourceType: "tenant",
              resourceId: String(target.id),
              details: { source: "owner-preview", ownerUserId: user.id, ownerEmail: user.email },
            });
          } catch (e) {
            // swallow — log only, not a hard error
          }
          activeTenant = target;
          ctx.previewTenantId = target.id;
          ctx.actingAsOwner = false;
        }
      }
    }

    ctx.tenant = activeTenant;
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
