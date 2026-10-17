import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { lockForUpdate } from "../../db/locking";
import { billInstances, billPushDeliveries, bills } from "../../db/schema";
import { DateOnlySchema } from "../types";
import { manilaDate } from "../payday/occurrences";
import { BillPostingError } from "./posting";

export function rescheduleBillInstance(instanceId: string, dueDate: string) {
  if (!DateOnlySchema.safeParse(dueDate).success) throw new BillPostingError("Choose a valid due date.");
  return db.transaction(async tx => {
    const [instance] = await lockForUpdate(tx.select().from(billInstances)
      .where(eq(billInstances.id, instanceId))).limit(1);
    if (!instance) throw new BillPostingError("Bill occurrence not found.", 404);
    if (!["upcoming", "due_today", "grace_period", "past_due"].includes(instance.status) || instance.linkedTransactionId || instance.cashPaidAt) {
      throw new BillPostingError("Only unpaid bill occurrences can be moved.", 409);
    }
    const [bill] = await tx.select().from(bills).where(eq(bills.id, instance.billId)).limit(1);
    if (!bill || !bill.isActive) throw new BillPostingError("This bill is unavailable.", 404);
    if (dueDate === instance.dueDate) return instance;
    const now = new Date();
    const today = manilaDate(now);
    const [moved] = await tx.update(billInstances).set({
      originalDueDate: instance.originalDueDate ?? instance.dueDate,
      dueDate, targetSettlementDate: dueDate,
      status: dueDate < today ? "past_due" : dueDate === today ? "due_today" : "upcoming",
      updatedAt: now,
    }).where(eq(billInstances.id, instanceId)).returning();
    await tx.update(billPushDeliveries).set({ status: "expired", nextAttemptAt: null, updatedAt: now })
      .where(and(eq(billPushDeliveries.billInstanceId, instanceId), inArray(billPushDeliveries.status, ["pending", "retryable"])));
    return moved;
  });
}
