import { db, client } from "./index";
import {
  accounts,
  categories,
  bills,
  billInstances,
  projectionSettings,
  transactions,
  transactionLegs,
} from "./schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("🌱 Starting LedgerFlow database seeding...");

  // 1. Seed Categories
  const defaultCategories = [
    { name: "Bank & Transfer Fees", isIncome: false, isSystemFee: true },
    { name: "Cash Outflow / Pocket Money", isIncome: false, isSystemFee: false },
    { name: "Salary & Primary Income", isIncome: true, isSystemFee: false },
    { name: "Utilities & Telecom", isIncome: false, isSystemFee: false },
    {
      name: "Subscriptions & Digital Services",
      isIncome: false,
      isSystemFee: false,
    },
    { name: "Food & Groceries", isIncome: false, isSystemFee: false },
    { name: "Transit & Transportation", isIncome: false, isSystemFee: false },
    { name: "General Living", isIncome: false, isSystemFee: false },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of defaultCategories) {
    const existing = await db
      .select()
      .from(categories)
      .where(eq(categories.name, cat.name));
    if (existing.length > 0) {
      categoryMap.set(cat.name, existing[0].id);
    } else {
      const [inserted] = await db.insert(categories).values(cat).returning();
      categoryMap.set(cat.name, inserted.id);
    }
  }
  console.log(`✓ Seeded ${categoryMap.size} categories`);

  // 2. Seed Accounts
  const defaultAccounts = [
    {
      name: "BPI Checking",
      type: "liquid" as const,
      currency: "PHP",
      currentBalance: 1850000, // ₱18,500.00
      initialBalance: 1850000,
    },
    {
      name: "Maya Wallet",
      type: "liquid" as const,
      currency: "PHP",
      currentBalance: 350000, // ₱3,500.00
      initialBalance: 350000,
    },
    {
      name: "Cash on Hand",
      type: "liquid" as const,
      currency: "PHP",
      currentBalance: 120000, // ₱1,200.00
      initialBalance: 120000,
    },
    {
      name: "BDO Card",
      type: "revolving_credit" as const,
      currency: "PHP",
      currentBalance: 420000, // ₱4,200.00
      initialBalance: 420000,
      creditLimit: 5000000, // ₱50,000.00
      statementCutoffDay: 18,
      paymentDueDay: 8,
    },
  ];

  const accountMap = new Map<string, string>();
  for (const acc of defaultAccounts) {
    const existing = await db
      .select()
      .from(accounts)
      .where(eq(accounts.name, acc.name));
    if (existing.length > 0) {
      accountMap.set(acc.name, existing[0].id);
    } else {
      const [inserted] = await db.insert(accounts).values(acc).returning();
      accountMap.set(acc.name, inserted.id);
    }
  }
  console.log(`✓ Seeded ${accountMap.size} accounts`);

  // 3. Seed Projection Settings
  const existingProj = await db.select().from(projectionSettings);
  if (existingProj.length === 0) {
    await db.insert(projectionSettings).values({
      expectedSalaryAmount: 3000000, // ₱30,000.00
      salaryCycleDays: "15,30",
      dailyDiscretionaryBurn: 85000, // ₱850.00 / day
    });
    console.log("✓ Seeded projection settings");
  }

  // 4. Seed Bills & Bill Instances
  const defaultBills = [
    {
      name: "Meralco Electricity",
      type: "variable_utility" as const,
      sourceAccountId: accountMap.get("BPI Checking"),
      categoryId: categoryMap.get("Utilities & Telecom"),
      amount: 285000, // ₱2,850.00
      isEstimate: false,
      isAutoPay: false,
      dueDayOfMonth: 6,
      gracePeriodDays: 7,
      instance: {
        periodIdentifier: "2026-10",
        dueDate: "2026-10-06",
        targetSettlementDate: "2026-10-06",
        amountDue: 285000,
        status: "grace_period" as const,
      },
    },
    {
      name: "PLDT Home Fiber",
      type: "fixed_subscription" as const,
      sourceAccountId: accountMap.get("Maya Wallet"),
      categoryId: categoryMap.get("Utilities & Telecom"),
      amount: 189900, // ₱1,899.00
      isEstimate: false,
      isAutoPay: false,
      dueDayOfMonth: 8,
      gracePeriodDays: 3,
      instance: {
        periodIdentifier: "2026-10",
        dueDate: "2026-10-08",
        targetSettlementDate: "2026-10-08",
        amountDue: 189900,
        status: "upcoming" as const,
      },
    },
    {
      name: "Maynilad Water",
      type: "variable_utility" as const,
      sourceAccountId: accountMap.get("BPI Checking"),
      categoryId: categoryMap.get("Utilities & Telecom"),
      amount: 45200, // ₱452.00
      isEstimate: true,
      isAutoPay: false,
      dueDayOfMonth: 9,
      gracePeriodDays: 5,
      instance: {
        periodIdentifier: "2026-10",
        dueDate: "2026-10-09",
        targetSettlementDate: "2026-10-09",
        amountDue: 45200,
        status: "upcoming" as const,
      },
    },
    {
      name: "Netflix Standard",
      type: "fixed_subscription" as const,
      sourceAccountId: accountMap.get("BDO Card"),
      categoryId: categoryMap.get("Subscriptions & Digital Services"),
      amount: 54900, // ₱549.00
      isEstimate: false,
      isAutoPay: true,
      dueDayOfMonth: 10,
      gracePeriodDays: 0,
      instance: {
        periodIdentifier: "2026-10",
        dueDate: "2026-10-10",
        targetSettlementDate: "2026-10-10",
        amountDue: 54900,
        status: "upcoming" as const,
      },
    },
    {
      name: "Spotify Family",
      type: "fixed_subscription" as const,
      sourceAccountId: accountMap.get("Maya Wallet"),
      categoryId: categoryMap.get("Subscriptions & Digital Services"),
      amount: 23900, // ₱239.00
      isEstimate: false,
      isAutoPay: true,
      dueDayOfMonth: 14,
      gracePeriodDays: 0,
      instance: {
        periodIdentifier: "2026-10",
        dueDate: "2026-10-14",
        targetSettlementDate: "2026-10-14",
        amountDue: 23900,
        status: "upcoming" as const,
      },
    },
  ];

  for (const b of defaultBills) {
    const existing = await db
      .select()
      .from(bills)
      .where(eq(bills.name, b.name));
    let billId = existing[0]?.id;
    if (!billId) {
      const [inserted] = await db
        .insert(bills)
        .values({
          name: b.name,
          type: b.type,
          sourceAccountId: b.sourceAccountId,
          categoryId: b.categoryId,
          amount: b.amount,
          isEstimate: b.isEstimate,
          isAutoPay: b.isAutoPay,
          dueDayOfMonth: b.dueDayOfMonth,
          gracePeriodDays: b.gracePeriodDays,
        })
        .returning();
      billId = inserted.id;
    }

    // Check instance
    const existingInstance = await db
      .select()
      .from(billInstances)
      .where(eq(billInstances.billId, billId));
    if (existingInstance.length === 0) {
      await db.insert(billInstances).values({
        billId,
        periodIdentifier: b.instance.periodIdentifier,
        dueDate: b.instance.dueDate,
        targetSettlementDate: b.instance.targetSettlementDate,
        amountDue: b.instance.amountDue,
        status: b.instance.status,
      });
    }
  }
  console.log(`✓ Seeded ${defaultBills.length} bills and instances`);

  console.log("✨ Seeding completed successfully!");
  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
