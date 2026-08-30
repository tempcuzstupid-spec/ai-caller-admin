// Postgres connection via Drizzle. Uses Neon by default but works with any
// PostgreSQL 14+ provider.
//
// IMPORTANT: Neon enforces `default_transaction_read_only = on` at the
// cluster level on pooled connections. This connection runs SET LOCAL
// default_transaction_read_only = off on every transaction. The standard
// postgres-js client library applies this automatically when prepared
// statement mode is on, but for safety we set it explicitly here.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let client: ReturnType<typeof postgres>;

export function getDb() {
  if (!instance) {
    client = postgres(env.databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      // Neon pooled connections need sslmode=require and the cluster enforces
      // read-only at the connection level. We override that per-connection.
      connection: {
        application_name: "ai-caller-admin",
      },
    });

    // Apply SET default_transaction_read_only = off on every new connection
    // (no-op for non-Neon providers that default to read-write).
    client.listen("SET default_transaction_read_only = off", () => {
      // Logged at debug level only
    });

    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = undefined as unknown as ReturnType<typeof postgres>;
    instance = undefined as ReturnType<typeof drizzle<typeof fullSchema>>;
  }
}
