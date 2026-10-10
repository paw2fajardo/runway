import {
  AnyPgColumn,
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

export const paycheckOccurrenceKindEnum = pgEnum("paycheck_occurrence_kind", [
  "scheduled",
  "retry",
]);

export const paycheckOccurrenceStatusEnum = pgEnum(
  "paycheck_occurrence_status",
  ["pending_confirmation", "confirmed", "reversed_awaiting_retry"]
);

export const paycheckPushDeliveryStatusEnum = pgEnum(
  "paycheck_push_delivery_status",
  ["pending", "retryable", "sent", "expired"]
);

export const ntfyDeliveryStatusEnum = pgEnum("ntfy_delivery_status", [
  "pending",
  "retryable",
  "sent",
]);

// Single local owner account. The fixed key prevents multiple owners.
export const ownerAuth = pgTable(
  "owner_auth",
  {
    id: integer("id").primaryKey().notNull().default(1),
    username: varchar("username", { length: 80 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [check("owner_auth_singleton_check", sql`${table.id} = 1`)]
);

export const ownerSessions = pgTable(
  "owner_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => ownerAuth.id, { onDelete: "cascade" }),
    tokenDigest: varchar("token_digest", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_owner_sessions_token_digest").on(table.tokenDigest),
    index("idx_owner_sessions_owner_id").on(table.ownerId),
    check(
      "owner_sessions_token_digest_check",
      sql`${table.tokenDigest} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

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
    initialBalance: bigint("initial_balance", { mode: "number" })
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
  isArchived: boolean("is_archived").notNull().default(false),
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
  autoPostFrom: date("auto_post_from", { mode: "string" }),
  isVariableAmount: boolean("is_variable_amount").notNull().default(false),
  dueDayOfMonth: smallint("due_day_of_month").notNull(),
  dueDayOfWeek: smallint("due_day_of_week"),
  frequency: varchar("frequency", { length: 20 }).notNull().default("monthly"),
  occurrenceLimit: smallint("occurrence_limit"),
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
    periodIdentifier: varchar("period_identifier", { length: 10 }).notNull(), // YYYY-MM-DD for each occurrence
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

export const billPaymentEvents = pgTable("bill_payment_events", {
  transactionId: uuid("transaction_id").primaryKey().references(() => transactions.id),
  billInstanceId: uuid("bill_instance_id").notNull().references(() => billInstances.id),
  kind: varchar("kind", { length: 20 }).notNull(),
}, (table) => [index("idx_bill_payment_events_instance").on(table.billInstanceId)]);

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
  billReminderTime: varchar("bill_reminder_time", { length: 5 }).notNull().default("09:00"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  billReminderTimeFormat: check(
    "projection_settings_bill_reminder_time_check",
    sql`${table.billReminderTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`
  ),
}));

export const incomeStreams = pgTable("income_streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectionSettingsId: uuid("projection_settings_id").notNull().references(() => projectionSettings.id),
  destinationAccountId: uuid("destination_account_id").references(() => accounts.id, { onDelete: "set null" }),
  destinationAccountSetDate: date("destination_account_set_date", { mode: "string" }),
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

// A durable record of each automatic credit or one-time retry. Snapshots keep
// the financial event intelligible if its stream or account is later changed.
export const paycheckOccurrences = pgTable(
  "paycheck_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incomeStreamId: uuid("income_stream_id")
      .notNull()
      .references(() => incomeStreams.id, { onDelete: "restrict" }),
    kind: paycheckOccurrenceKindEnum("kind").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    retryDate: date("retry_date", { mode: "string" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    accountNameSnapshot: varchar("account_name_snapshot", { length: 100 }),
    amountSnapshot: bigint("amount_snapshot", { mode: "number" }).notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    status: paycheckOccurrenceStatusEnum("status")
      .notNull()
      .default("pending_confirmation"),
    parentOccurrenceId: uuid("parent_occurrence_id").references(
      (): AnyPgColumn => paycheckOccurrences.id,
      { onDelete: "restrict" }
    ),
    reversalTransactionId: uuid("reversal_transaction_id").references(
      () => transactions.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_paycheck_scheduled_stream_date")
      .on(table.incomeStreamId, table.dueDate)
      .where(sql`${table.kind} = 'scheduled'`),
    uniqueIndex("uq_paycheck_retry_parent_date")
      .on(table.parentOccurrenceId, table.retryDate)
      .where(sql`${table.kind} = 'retry'`),
    index("idx_paycheck_occurrences_due_status").on(table.dueDate, table.status),
    index("idx_paycheck_occurrences_stream_date").on(
      table.incomeStreamId,
      table.dueDate
    ),
    index("idx_paycheck_occurrences_parent").on(table.parentOccurrenceId),
    index("idx_paycheck_occurrences_transaction").on(table.transactionId),
    index("idx_paycheck_occurrences_reversal").on(table.reversalTransactionId),
    check(
      "paycheck_occurrences_amount_check",
      sql`${table.amountSnapshot} > 0 AND ${table.amountSnapshot} <= 9007199254740991`
    ),
    check(
      "paycheck_occurrences_kind_fields_check",
      sql`(${table.kind} = 'scheduled' AND ${table.parentOccurrenceId} IS NULL AND ${table.retryDate} IS NULL) OR (${table.kind} = 'retry' AND ${table.parentOccurrenceId} IS NOT NULL AND ${table.retryDate} IS NOT NULL AND ${table.retryDate} = ${table.dueDate})`
    ),
  ]
);

// One registered browser endpoint belonging to the single local owner.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: integer("owner_id")
      .notNull()
      .references(() => ownerAuth.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_push_subscriptions_endpoint_hash").on(table.endpointHash),
    index("idx_push_subscriptions_owner_id").on(table.ownerId),
    check(
      "push_subscriptions_endpoint_hash_check",
      sql`${table.endpointHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

// Keeps per-paycheck delivery state after an expired browser endpoint is deleted.
// endpointHashSnapshot is the stable unique identity; subscriptionId may become
// NULL when the endpoint is removed without losing the send/retry history.
export const paycheckPushDeliveries = pgTable(
  "paycheck_push_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => paycheckOccurrences.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(
      () => pushSubscriptions.id,
      { onDelete: "set null" }
    ),
    endpointHashSnapshot: varchar("endpoint_hash_snapshot", {
      length: 64,
    }).notNull(),
    status: paycheckPushDeliveryStatusEnum("status")
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_paycheck_push_occurrence_endpoint").on(
      table.occurrenceId,
      table.endpointHashSnapshot
    ),
    index("idx_paycheck_push_deliveries_retry").on(
      table.status,
      table.nextAttemptAt
    ),
    check(
      "paycheck_push_deliveries_endpoint_hash_check",
      sql`${table.endpointHashSnapshot} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "paycheck_push_deliveries_attempt_count_check",
      sql`${table.attemptCount} >= 0`
    ),
  ]
);

// One reminder per bill occurrence, device, and Manila calendar day.
export const billPushDeliveries = pgTable(
  "bill_push_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billInstanceId: uuid("bill_instance_id")
      .notNull()
      .references(() => billInstances.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(
      () => pushSubscriptions.id,
      { onDelete: "set null" }
    ),
    endpointHashSnapshot: varchar("endpoint_hash_snapshot", { length: 64 }).notNull(),
    reminderDate: date("reminder_date", { mode: "string" }).notNull(),
    status: paycheckPushDeliveryStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_bill_push_instance_endpoint_reminder").on(
      table.billInstanceId, table.endpointHashSnapshot, table.reminderDate
    ),
    index("idx_bill_push_deliveries_retry").on(table.status, table.nextAttemptAt),
    check("bill_push_deliveries_endpoint_hash_check", sql`${table.endpointHashSnapshot} ~ '^[0-9a-f]{64}$'`),
    check("bill_push_deliveries_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ]
);

export const ntfyDeliveries = pgTable(
  "ntfy_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationKey: varchar("notification_key", { length: 180 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    message: text("message").notNull(),
    status: ntfyDeliveryStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_ntfy_deliveries_notification_key").on(table.notificationKey),
    index("idx_ntfy_deliveries_retry").on(table.status, table.nextAttemptAt),
    check("ntfy_deliveries_attempt_count_check", sql`${table.attemptCount} >= 0`),
  ]
);
export const incomeStreamDeposits = pgTable("income_stream_deposits", {
  id: uuid("id").primaryKey().defaultRandom(),
  incomeStreamId: uuid("income_stream_id").notNull().references(() => incomeStreams.id, { onDelete: "restrict" }),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  depositedAt: timestamp("deposited_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueOccurrence: uniqueIndex("income_stream_deposits_stream_date_unique").on(table.incomeStreamId, table.scheduledDate),
  validAmount: check("income_stream_deposits_amount_check", sql`${table.amountCents} > 0 AND ${table.amountCents} <= 9007199254740991`),
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

export type PaycheckOccurrence = typeof paycheckOccurrences.$inferSelect;
export type NewPaycheckOccurrence = typeof paycheckOccurrences.$inferInsert;

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
