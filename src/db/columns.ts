import { randomUUID } from "node:crypto";
import { sql, type AnyColumn } from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import * as sqlite from "drizzle-orm/sqlite-core";
import { databaseConfig } from "./config";

// Keep one schema and one application row shape across both dialects. The casts
// stay at this boundary; SQLite builders preserve strings, numbers, Dates and JSON.
const localColumns = {
  pgTable: (name: string, columns: Record<string, sqlite.SQLiteColumnBuilderBase>, extra?: (table: Record<string, sqlite.AnySQLiteColumn>) => sqlite.SQLiteTableExtraConfig) =>
    sqlite.sqliteTable(name, columns, (table) => {
      const constraints = extra?.(table) ?? {};
      const enumChecks = Object.values(table).filter(column => column.enumValues?.length).map(column =>
        sqlite.check(`${name}_${column.name}_enum`, sql`${column} in (${sql.join(column.enumValues!.map(value => sql`${value}`), sql`, `)})`.inlineParams()));
      return [...Object.values(constraints), ...enumChecks];
    }),
  uuid: (name: string) => {
    const column = sqlite.text(name);
    return Object.assign(column, { defaultRandom: () => column.$defaultFn(randomUUID) });
  },
  varchar: (name: string) => sqlite.text(name),
  text: sqlite.text,
  bigint: (name: string) => sqlite.integer(name),
  integer: sqlite.integer,
  smallint: sqlite.integer,
  boolean: (name: string) => sqlite.integer(name, { mode: "boolean" }),
  timestamp: (name: string) => {
    const column = sqlite.integer(name, { mode: "timestamp_ms" });
    return Object.assign(column, {
      defaultNow: () => column.default(sql`(cast((julianday('now') - 2440587.5) * 86400000 as integer))`),
    });
  },
  date: (name: string) => sqlite.text(name),
  jsonb: (name: string) => sqlite.text(name, { mode: "json" }),
  pgEnum: (_name: string, values: [string, ...string[]]) => Object.assign(
    (name: string) => sqlite.text(name, { enum: values }), { enumValues: values },
  ),
  uniqueIndex: sqlite.uniqueIndex,
  index: sqlite.index,
  check: sqlite.check,
};

const columns = databaseConfig.sqlite ? localColumns as unknown as typeof pg : pg;
export const { pgTable, uuid, varchar, text, bigint, integer, smallint, boolean, timestamp, date, jsonb, pgEnum, uniqueIndex, index, check } = columns;
export type AnyPgColumn = pg.AnyPgColumn;

export function hexDigestCheck(column: AnyColumn) {
  return databaseConfig.sqlite
    ? sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`
    : sql`${column} ~ '^[0-9a-f]{64}$'`;
}

export function reminderTimeCheck(column: AnyColumn) {
  return databaseConfig.sqlite
    ? sql`${column} GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(${column}, 1, 2) < '24'`
    : sql`${column} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`;
}
