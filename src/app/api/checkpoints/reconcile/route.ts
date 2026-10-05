import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../db";
import {
  accounts,
  balanceCheckpoints,
  transactions,
  transactionLegs,
} from "../../../../db/schema";
import { CheckpointReconcileSchema } from "../../../../lib/types";
import { eq } from "drizzle-orm";
import { assertSameOrigin, requireOwner } from "../../../../lib/auth/guard";

export async function POST(req: NextRequest) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;
  const owner = await requireOwner(req);
  if (owner instanceof Response) return owner;

  try {
    const body = await req.json();
    const parsed = CheckpointReconcileSchema.parse(body);

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, parsed.account_id))
      .limit(1);

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const discrepancy = parsed.observed_balance - account.currentBalance;

    const result = await db.transaction(async (tx) => {
      // 1. Record balance checkpoint
      const [checkpoint] = await tx
        .insert(balanceCheckpoints)
        .values({
          accountId: parsed.account_id,
          verifiedBalance: parsed.observed_balance,
          discrepancyAmount: discrepancy,
        })
        .returning();

      // 2. If discrepancy exists, record a balancing drift transaction
      let driftTx = null;
      if (discrepancy !== 0) {
        const isPositive = discrepancy > 0;
        const [parentTx] = await tx
          .insert(transactions)
          .values({
            type: isPositive ? "income" : "expense",
            description: "Balance Adjustment Drift",
          })
          .returning();

        await tx.insert(transactionLegs).values({
          transactionId: parentTx.id,
          accountId: parsed.account_id,
          amount: discrepancy,
        });

        driftTx = parentTx;
      }

      // 3. Set exact observed balance on account
      await tx
        .update(accounts)
        .set({
          currentBalance: parsed.observed_balance,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, parsed.account_id));

      return {
        checkpoint,
        discrepancy,
        observed_balance: parsed.observed_balance,
        drift_transaction: driftTx,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    console.error("Checkpoint reconcile failed:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
