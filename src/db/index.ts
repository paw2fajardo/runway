import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "@libsql/client";
import { drizzle as sqliteDrizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { databaseConfig } from "./config";

function connect() {
  if (databaseConfig.sqlite) {
    const sqliteClient = createClient({ url: databaseConfig.url, intMode: "number" });
    // libSQL starts write transactions with BEGIN IMMEDIATE, serializing local
    // writers in place of PostgreSQL row/advisory locks.
    return {
      db: sqliteDrizzle(sqliteClient, { schema }) as unknown as ReturnType<typeof drizzle<typeof schema>>,
      client: { end: async () => sqliteClient.close() },
    };
  }
  const client = postgres(databaseConfig.url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return { db: drizzle(client, { schema }), client };
}

export const { db, client } = connect();
export default db;
