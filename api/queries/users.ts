import { eq } from "drizzle-orm";
import * as schema from "@db/schema";

import { getDb } from "./connection";
import { env } from "../lib/env";

export async function findUserByUnionId(unionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.users)
    .where(eq(schema.users.unionId, unionId))
    .limit(1);
  return rows.at(0);
}

// Upsert a user keyed on unionId. The Postgres way is ON CONFLICT (union_id)
// DO UPDATE — not onDuplicateKeyUpdate (which is MySQL/Drizzle-MySQL only).
export async function upsertUser(data: {
  unionId: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
}) {
  const values = { ...data };
  const updateSet = {
    lastSignInAt: new Date(),
    name: data.name ?? null,
    email: data.email ?? null,
    avatar: data.avatar ?? null,
  };

  // Owner gets admin role on first login
  if (values.unionId && values.unionId === env.ownerUnionId) {
    (values as any).role = "admin";
    (updateSet as any).role = "admin";
  }

  await getDb()
    .insert(schema.users)
    .values(values as any)
    .onConflictDoUpdate({
      target: schema.users.unionId,
      set: updateSet,
    });
}
