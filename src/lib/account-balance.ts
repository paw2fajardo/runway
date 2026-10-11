import { sql } from "drizzle-orm";
import { accounts } from "../db/schema";

/** Account legs track cash flow; credit balances track outstanding debt. */
export function balanceAfterAccountLeg(amount: number) {
  return sql<number>`${accounts.currentBalance} + CASE WHEN ${accounts.type} = 'revolving_credit' THEN ${-amount} ELSE ${amount} END`;
}
