import { z } from "zod";

// Compound Transaction Schema
export const CompoundTransactionSchema = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1, "Description is required"),
  source_account_id: z.string().uuid().optional().nullable(),
  destination_account_id: z.string().uuid().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().min(1).max(100).optional(),
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
}).strict().superRefine((value, ctx) => {
  if (value.schedule_kind === "custom" ? value.interval_days === undefined : value.interval_days !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interval_days"], message: "Only custom schedules require an interval from 1 to 366 days." });
  }
});

export type PaySettingsInput = z.infer<typeof PaySettingsSchema>;
const incomeStreamFields = {
  name: z.string().trim().min(1).max(100),
  net_pay_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  next_pay_date: DateOnlySchema,
  schedule_kind: PayScheduleKindSchema,
  interval_days: z.number().int().min(1).max(366).optional(),
  is_enabled: z.boolean().optional(),
};
export const IncomeStreamCreateSchema = z.object(incomeStreamFields).strict().superRefine((value, ctx) => {
  if (value.schedule_kind === "custom" ? value.interval_days === undefined : value.interval_days !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["interval_days"], message: "Custom schedules require an interval from 1 to 366 days." });
  }
});
export const IncomeStreamPatchSchema = z.object(incomeStreamFields).partial().strict().refine(value => Object.keys(value).length > 0, "Provide a change");
export interface IncomeStreamResponse {
  id: string;
  name: string;
  net_pay_cents: number;
  schedule_kind: PayScheduleKind | "calendar";
  payday_anchor: string | null;
  interval_days: number | null;
  salary_cycle_days: string;
  is_enabled: boolean;
  next_pay_date: string;
}
export interface IncomeStreamsResponse { streams: IncomeStreamResponse[] }
export type PaySettingsResponse = { configured: false } | {
  configured: true;
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
}

export interface RunwayForecastResponse {
  current_liquid_cash: number;
  confirmed_inflows: number;
  scheduled_bills_total: number;
  discretionary_burn_total: number;
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
