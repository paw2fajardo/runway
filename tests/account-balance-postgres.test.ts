import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { accounts } from "../src/db/schema";
import { balanceAfterAccountLeg } from "../src/lib/account-balance";

// Opt in with a local PostgreSQL URL. All writes use a session-local temp table.
const url = process.env.RUNWAY_POSTGRES_TEST_URL;
describe.skipIf(!url)("PostgreSQL account balance updates", () => {
  let client: ReturnType<typeof postgres>;
  let database: ReturnType<typeof drizzle>;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
      throw new Error("Balance regression tests require a local PostgreSQL instance.");
    }
    client = postgres(url!, { max: 1 });
    // Exclude public so a lost temp table cannot resolve to application data.
    await client`SET search_path TO pg_temp`;
    await client`CREATE TEMP TABLE accounts (id uuid PRIMARY KEY, type text NOT NULL, current_balance bigint NOT NULL)`;
    database = drizzle(client);
  });
  afterAll(async () => { await client?.end(); });

  it.each([
    ["liquid", -1000, 9000],
    ["liquid", 1000, 11000],
    ["revolving_credit", -1000, 11000],
    ["revolving_credit", 1000, 9000],
    ["liquid", 3000000000, 3000010000],
  ] as const)("applies a %s account leg of %i cents", async (type, amount, expected) => {
    const id = randomUUID();
    await client`INSERT INTO pg_temp.accounts (id, type, current_balance) VALUES (${id}, ${type}, 10000)`;
    const [row] = await database.update(accounts).set({ currentBalance: balanceAfterAccountLeg(amount) })
      .where(eq(accounts.id, id)).returning({ balance: accounts.currentBalance });
    expect(row.balance).toBe(expected);
  });
});
