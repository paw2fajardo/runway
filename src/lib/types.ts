import { z } from "zod";

// Compound Transaction Schema
export const CompoundTransactionSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1, "Description is required"),
  source_account_id: z.string().uuid().optional().nullable(),
  destination_account_id: z.string().uuid().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().min(1).max(100).optional(),
  bill_instance_id: z.string().uuid().optional(),
  gross_outflow: z.number().int().nonnegative().optional().default(0), // in cents
  net_inflow: z.number().int().nonnegative().optional().default(0), // in cents
  fee_amount: z.number().int().nonnegative().optional().default(0), // in cents
  transacted_at: z.string().datetime().optional().default(() => new Date().toISOString()),
});

export type CompoundTransactionInput = z.infer<typeof CompoundTransactionSchema>;

// Checkpoint Reconcile Schema
export const CheckpointReconcileSchema = z.object({
  account_id: z.string().uuid("Valid account ID is required"),
  observed_balance: z.number().int("Observed balance must be in cents"),
});

export type CheckpointReconcileInput = z.infer<typeof CheckpointReconcileSchema>;

export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return value.slice(0, 4) !== "0000" && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "A real YYYY-MM-DD date is required");

export const PayScheduleKindSchema = z.enum(["weekly", "biweekly", "monthly", "custom"]);
export type PayScheduleKind = z.infer<typeof PayScheduleKindSchema>;
export const PaySettingsSchema = z.object({
  net_pay_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  next_pay_date: DateOnlySchema,
  schedule_kind: PayScheduleKindSchema.optional(),
  interval_days: z.number().int().min(1).max(366).optional(),
  daily_discretionary_burn_cents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.schedule_kind === "custom" ? value.interval_days === undefined : value.interval_days !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interval_days"], message: "Only custom schedules require an interval from 1 to 366 days." });
  }
});

export type PaySettingsInput = z.infer<typeof PaySettingsSchema>;
export const MAX_DAILY_DISCRETIONARY_BURN_CENTS = Math.floor(Number.MAX_SAFE_INTEGER / 366);
export const DailyDiscretionaryBurnSchema = z.object({
  daily_discretionary_burn_cents: z.number().int().nonnegative().max(MAX_DAILY_DISCRETIONARY_BURN_CENTS),
}).strict();
export type DailyDiscretionaryBurnInput = z.infer<typeof DailyDiscretionaryBurnSchema>;
export const DEFAULT_BILL_REMINDER_TIME = "09:00";
export const BillReminderTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const BillReminderTimeSettingsSchema = z.object({ bill_reminder_time: BillReminderTimeSchema }).strict();

export const CategoryCreateSchema = z.object({ name: z.string().trim().min(1).max(100), is_income: z.boolean().default(false) }).strict();
export const CategoryPatchSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), is_income: z.boolean().optional(), is_archived: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0);
const incomeStreamFields = {
  name: z.string().trim().min(1).max(100),
  net_pay_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  next_pay_date: DateOnlySchema,
  schedule_kind: PayScheduleKindSchema,
  interval_days: z.number().int().min(1).max(366).optional(),
  is_enabled: z.boolean().optional(),
  destination_account_id: z.string().uuid().nullable().optional(),
};
export const IncomeStreamCreateSchema = z.object({ ...incomeStreamFields, destination_account_id: z.string().uuid("Choose a valid account") }).strict().superRefine((value, ctx) => {
  if (value.schedule_kind === "custom" ? value.interval_days === undefined : value.interval_days !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interval_days"], message: "Custom schedules require an interval from 1 to 366 days." });
  }
});
export const IncomeStreamPatchSchema = z.object(incomeStreamFields).partial().strict().refine(value => Object.keys(value).length > 0, "Provide a change");
export interface IncomeStreamAccountSummary { id: string; name: string; type: string; currency: string }
export interface IncomeStreamResponse {
  id: string;
  name: string;
  net_pay_cents: number;
  schedule_kind: PayScheduleKind | "calendar";
  payday_anchor: string | null;
  interval_days: number | null;
  salary_cycle_days: string;
  is_enabled: boolean;
  destination_account_id: string | null;
  next_pay_date: string;
}
export interface IncomeStreamsResponse { streams: IncomeStreamResponse[] }
export type PaySettingsResponse = { configured: false; daily_discretionary_burn_cents: number } | {
  configured: true;
  daily_discretionary_burn_cents: number;
  net_pay_cents: number;
  schedule_kind: PayScheduleKind | "calendar";
  interval_days: number | null;
  payday_anchor: string | null;
  next_pay_date: string;
  salary_cycle_days: string;
  is_enabled?: boolean;
};

// Runway Forecast Types
export interface TimelineDay {
  date: string;
  inflow: number; // in cents
  outflow: number; // in cents
  balance: number; // projected liquid balance at end of day in cents
  isPayday?: boolean;
  hasDues?: boolean;
  isGraceActive?: boolean;
  duesDescription?: string[];
  incomeDescription?: string[];
  plannedSpending?: string[];
}

export interface RunwayForecastResponse {
  current_liquid_cash: number;
  confirmed_inflows: number;
  scheduled_bills_total: number;
  discretionary_burn_total: number;
  planned_spending_total: number;
  net_projected_buffer: number;
  daily_allowance: number;
  days_to_payday: number;
  next_payday_date: string;
  is_solvent: boolean;
  shortfall_date: string | null;
  shortfall_amount: number;
  timeline: TimelineDay[];
}

// AI Ingestion Parsed Structure Schema
export const ParsedInboxItemSchema = z.object({
  merchant: z.string(),
  amount_cents: z.number().int(),
  transacted_at: z.string().optional(),
  type: z.enum(["expense", "transfer", "income"]).default("expense"),
  source_account_hint: z.string().optional(),
  destination_account_hint: z.string().optional(),
  category_hint: z.string().optional(),
  fee_cents: z.number().int().default(0),
  confidence: z.number().min(0).max(1).default(1),
  raw_summary: z.string(),
});

export type ParsedInboxItem = z.infer<typeof ParsedInboxItemSchema>;
