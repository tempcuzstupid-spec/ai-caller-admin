// Postgres connection via Drizzle. Uses Neon by default but works with any
// PostgreSQL 14+ provider.
//
// IMPORTANT: Neon enforces `default_transaction_read_only = on` at the
// cluster level on pooled connections. This connection runs SET
// default_transaction_read_only = off on every new connection. The standard
// postgres-js client library applies this automatically when prepared
// statement mode is on, but for safety we set it explicitly.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };
type Db = PostgresJsDatabase<typeof fullSchema>;

let instance: Db | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function getDb(): Db {
  if (!instance) {
    client = postgres(env.databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      connection: {
        application_name: "ai-caller-admin",
      },
    });

    // Apply SET default_transaction_read_only = off on every new connection.
    client.listen("SET default_transaction_read_only = off", () => {
      // No-op callback
    });

    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    instance = null;
  }
}
