// tRPC context — resolves the authenticated user AND their current tenant.
//
// On every request, after Kimi auth gives us a User, we look up their
// defaultTenantId and load the Tenant row into ctx.tenant. Every tenant-scoped
// router reads ctx.tenant.id and filters on it.
//
// For a single-user-owns-many-tenants model, a tenant switcher in the UI
// would override ctx.tenant via a header. For now, default tenant is the
// single value.

import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User, Tenant } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { getDb } from "./queries/connection";
import { tenants as tenantsTable } from "@db/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  tenant?: Tenant;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    const user = await authenticateRequest(opts.req.headers);
    ctx.user = user;

    if (user.defaultTenantId) {
      const tenant = await getDb().query.tenants.findFirst({
        where: eq(tenantsTable.id, user.defaultTenantId),
      });
      if (tenant) ctx.tenant = tenant;
    }
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
