import { sql, type SQL } from "drizzle-orm";
import { databaseConfig } from "./config";

export function lockForUpdate<T extends { for(strength: "update"): unknown }>(query: T): T {
  return databaseConfig.sqlite ? query : query.for("update") as T;
}

export async function lockIncomeSettings(tx: { execute(query: SQL): unknown }) {
  if (!databaseConfig.sqlite) {
    await tx.execute(sql`select pg_advisory_xact_lock(73142001)`);
  }
}
