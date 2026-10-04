import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  smallint,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Enums
export const accountTypeEnum = pgEnum("account_type", [
  "liquid",
  "revolving_credit",
  "installment_loan",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
]);

export const billTypeEnum = pgEnum("bill_type", [
  "fixed_subscription",
  "variable_utility",
  "credit_card_statement",
  "loan_installment",
]);

export const billStatusEnum = pgEnum("bill_status", [
  "upcoming",
  "due_today",
  "grace_period",
  "past_due",
  "paid",
  "auto_debited",
]);

export const inboxItemStatusEnum = pgEnum("inbox_item_status", [
  "pending",
  "approved",
  "discarded",
]);

// 1. Accounts
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 100 }).notNull(),
    type: accountTypeEnum("type").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("PHP"),
    currentBalance: bigint("current_balance", { mode: "number" })
      .notNull()
      .default(0),
    creditLimit: bigint("credit_limit", { mode: "number" }),
    statementCutoffDay: smallint("statement_cutoff_day"),
    paymentDueDay: smallint("payment_due_day"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_accounts_type").on(table.type)]
);

// 2. Categories
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  isIncome: boolean("is_income").notNull().default(false),
  isSystemFee: boolean("is_system_fee").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 3. Transactions (Parent Envelope)
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: transactionTypeEnum("type").notNull(),
    description: text("description").notNull(),
    transactedAt: timestamp("transacted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_transactions_transacted_at").on(table.transactedAt)]
);

// 4. Transaction Legs (Atomic Double/Triple Splits)
export const transactionLegs = pgTable(
  "transaction_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    amount: bigint("amount", { mode: "number" }).notNull(), // Negative for outflow, positive for inflow
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_legs_transaction_id").on(table.transactionId),
    index("idx_legs_account_id").on(table.accountId),
  ]
);

// 5. Bills & Recurring Obligations
export const bills = pgTable("bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  type: billTypeEnum("type").notNull(),
  sourceAccountId: uuid("source_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  targetAccountId: uuid("target_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  isEstimate: boolean("is_estimate").notNull().default(false),
  isAutoPay: boolean("is_auto_pay").notNull().default(false),
  dueDayOfMonth: smallint("due_day_of_month").notNull(),
  gracePeriodDays: smallint("grace_period_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 6. Bill Instances (Monthly Ledger Tracking)
export const billInstances = pgTable(
  "bill_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    periodIdentifier: varchar("period_identifier", { length: 7 }).notNull(), // e.g., '2026-10'
    dueDate: date("due_date", { mode: "string" }).notNull(),
    targetSettlementDate: date("target_settlement_date", {
      mode: "string",
    }).notNull(),
    amountDue: bigint("amount_due", { mode: "number" }).notNull(),
    status: billStatusEnum("status").notNull().default("upcoming"),
    linkedTransactionId: uuid("linked_transaction_id").references(
      () => transactions.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_bill_period").on(table.billId, table.periodIdentifier),
    index("idx_bill_instances_dates").on(table.dueDate, table.status),
  ]
);

// 7. Balance Checkpoints
export const balanceCheckpoints = pgTable("balance_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  verifiedBalance: bigint("verified_balance", { mode: "number" }).notNull(),
  discrepancyAmount: bigint("discrepancy_amount", { mode: "number" })
    .notNull()
    .default(0),
  checkpointAt: timestamp("checkpoint_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 8. Income Profiles & Projection Parameters
export const projectionSettings = pgTable("projection_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  expectedSalaryAmount: bigint("expected_salary_amount", {
    mode: "number",
  }).notNull(),
  salaryCycleDays: varchar("salary_cycle_days", { length: 50 })
    .notNull()
    .default("15,30"), // Comma-separated calendar days
  biweeklyPaydayAnchor: date("biweekly_payday_anchor", { mode: "string" }),
  payScheduleKind: varchar("pay_schedule_kind", { length: 20 }),
  payIntervalDays: integer("pay_interval_days"),
  dailyDiscretionaryBurn: bigint("daily_discretionary_burn", { mode: "number" })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const incomeStreams = pgTable("income_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectionSettingsId: uuid("projection_settings_id").notNull().references(() => projectionSettings.id),
  name: varchar("name", { length: 100 }).notNull(),
  netPayCents: bigint("net_pay_cents", { mode: "number" }).notNull(),
  scheduleKind: varchar("schedule_kind", { length: 20 }),
  paydayAnchor: date("payday_anchor", { mode: "string" }),
  intervalDays: integer("interval_days"),
  salaryCycleDays: varchar("salary_cycle_days", { length: 50 }).notNull().default("15,30"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  validName: check("income_streams_name_check", sql`length(btrim(${table.name})) > 0`),
  validAmount: check("income_streams_amount_check", sql`${table.netPayCents} > 0 AND ${table.netPayCents} <= 9007199254740991`),
  validSchedule: check("income_streams_schedule_check", sql`
    (${table.scheduleKind} IS NULL AND ${table.intervalDays} IS NULL)
    OR (${table.scheduleKind} IS NOT NULL AND ${table.scheduleKind} IN ('weekly', 'biweekly', 'monthly', 'custom')
      AND ${table.paydayAnchor} IS NOT NULL
      AND ((${table.scheduleKind} = 'custom' AND ${table.intervalDays} IS NOT NULL AND ${table.intervalDays} BETWEEN 1 AND 366)
        OR (${table.scheduleKind} <> 'custom' AND ${table.intervalDays} IS NULL)))
  `),
}));

// 9. Ingestion Inbox (AI / SMS Staging Queue)
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceChannel: varchar("source_channel", { length: 50 })
      .notNull()
      .default("manual"), // 'sms', 'ocr_receipt', 'pdf_bill', 'quick_text'
    rawPayload: text("raw_payload").notNull(),
    parsedJson: jsonb("parsed_json").notNull(),
    status: inboxItemStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_inbox_items_status").on(table.status)]
);

// Relations
export const accountsRelations = relations(accounts, ({ many }) => ({
  transactionLegs: many(transactionLegs),
  balanceCheckpoints: many(balanceCheckpoints),
  billsAsSource: many(bills, { relationName: "billSourceAccount" }),
  billsAsTarget: many(bills, { relationName: "billTargetAccount" }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  transactionLegs: many(transactionLegs),
  bills: many(bills),
}));

export const transactionsRelations = relations(transactions, ({ many }) => ({
  legs: many(transactionLegs),
  linkedBillInstances: many(billInstances),
}));

export const transactionLegsRelations = relations(
  transactionLegs,
  ({ one }) => ({
    transaction: one(transactions, {
      fields: [transactionLegs.transactionId],
      references: [transactions.id],
    }),
    account: one(accounts, {
      fields: [transactionLegs.accountId],
      references: [accounts.id],
    }),
    category: one(categories, {
      fields: [transactionLegs.categoryId],
      references: [categories.id],
    }),
  })
);

export const billsRelations = relations(bills, ({ one, many }) => ({
  sourceAccount: one(accounts, {
    fields: [bills.sourceAccountId],
    references: [accounts.id],
    relationName: "billSourceAccount",
  }),
  targetAccount: one(accounts, {
    fields: [bills.targetAccountId],
    references: [accounts.id],
    relationName: "billTargetAccount",
  }),
  category: one(categories, {
    fields: [bills.categoryId],
    references: [categories.id],
  }),
  instances: many(billInstances),
}));

export const billInstancesRelations = relations(billInstances, ({ one }) => ({
  bill: one(bills, {
    fields: [billInstances.billId],
    references: [bills.id],
  }),
  linkedTransaction: one(transactions, {
    fields: [billInstances.linkedTransactionId],
    references: [transactions.id],
  }),
}));

export const balanceCheckpointsRelations = relations(
  balanceCheckpoints,
  ({ one }) => ({
    account: one(accounts, {
      fields: [balanceCheckpoints.accountId],
      references: [accounts.id],
    }),
  })
);

// Inferred TypeScript Types
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type TransactionLeg = typeof transactionLegs.$inferSelect;
export type NewTransactionLeg = typeof transactionLegs.$inferInsert;

export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;

export type BillInstance = typeof billInstances.$inferSelect;
export type NewBillInstance = typeof billInstances.$inferInsert;

export type BalanceCheckpoint = typeof balanceCheckpoints.$inferSelect;
export type NewBalanceCheckpoint = typeof balanceCheckpoints.$inferInsert;

export type ProjectionSetting = typeof projectionSettings.$inferSelect;
export type NewProjectionSetting = typeof projectionSettings.$inferInsert;

export type IncomeStream = typeof incomeStreams.$inferSelect;
export type NewIncomeStream = typeof incomeStreams.$inferInsert;

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
