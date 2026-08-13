import { z } from "zod";

import { isoDateSchema } from "./masters.ts";
import { granularitySchema } from "./periods.ts";

/* -------------------------------------------------------------------------- */
/*  Exchange rates                                                             */
/* -------------------------------------------------------------------------- */

export const FX_MODES = ["fixed", "live"] as const;
export const fxModeSchema = z.enum(FX_MODES);
export type FxMode = z.infer<typeof fxModeSchema>;

export const FX_MODE_LABELS: Record<FxMode, string> = {
  fixed: "One rate I set myself",
  live: "Fetched daily from a provider",
};

/**
 * Which rate a translated report uses.
 *
 * `period_end` is the honest default for a balance — what a taka was worth on
 * the day the figure was true. `current` answers "what is this worth to me
 * today", which is a different question and should be asked deliberately.
 */
export const FX_REPORT_BASES = ["period_end", "period_average", "current"] as const;
export const fxReportBasisSchema = z.enum(FX_REPORT_BASES);
export type FxReportBasis = z.infer<typeof fxReportBasisSchema>;

export const FX_REPORT_BASIS_LABELS: Record<FxReportBasis, string> = {
  period_end: "The rate on the last day of the period",
  period_average: "The average rate across the period",
  current: "Today's rate",
};

export const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 118.40")
  .refine((v) => Number(v) > 0, "The rate must be above zero");

export const setFxRateSchema = z.strictObject({
  rate: rateSchema,
  rateDate: isoDateSchema,
  notes: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});
export type SetFxRateInput = z.infer<typeof setFxRateSchema>;

export const listFxRatesQuerySchema = z.strictObject({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(400).default(90),
});
export type ListFxRatesQuery = z.infer<typeof listFxRatesQuerySchema>;

/**
 * What produced a translated figure.
 *
 * Every USD number in the app carries one of these. A dollar figure with no
 * visible provenance invites being read as a fact, and two months translated
 * at different rates then look like a change in the business when nothing
 * moved but the currency.
 */
export type FxContext = {
  rate: string;
  /** The date the rate applies to. */
  asOf: string;
  basis: FxReportBasis;
  source: "manual" | "api";
  /** Ready to render: "translated at 118.40, as of 31 Jul 2026 (period end)". */
  caption: string;
  /** True when no rate could be found and BDT is all that can be shown. */
  unavailable: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Reports                                                                    */
/* -------------------------------------------------------------------------- */

export const CURRENCY_VIEWS = ["BDT", "USD"] as const;
export const currencyViewSchema = z.enum(CURRENCY_VIEWS);
export type CurrencyView = z.infer<typeof currencyViewSchema>;

export const periodQuerySchema = z.strictObject({
  granularity: granularitySchema.default("month"),
  /** The fiscal year's starting calendar year. */
  fiscalYear: z.coerce.number().int().min(2000).max(2200).optional(),
  /** Which period within that year: 1-12 for months, 1-4 quarters, 1-2 halves. */
  index: z.coerce.number().int().min(1).max(12).optional(),
  currency: currencyViewSchema.default("BDT"),
});
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export const bankStatsQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200),
  accountId: z.string().uuid().optional(),
  currency: currencyViewSchema.default("BDT"),
});
export type BankStatsQuery = z.infer<typeof bankStatsQuerySchema>;

export const fundingQuerySchema = z.strictObject({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type FundingQuery = z.infer<typeof fundingQuerySchema>;

export type CategoryLine = {
  id: string | null;
  name: string;
  color: string | null;
  total: string;
  share: number;
};

export type PeriodReport = {
  label: string;
  start: string;
  end: string;
  currency: CurrencyView;
  fx: FxContext | null;
  moneyIn: string;
  moneyOut: string;
  net: string;
  entries: number;
  openingBalance: string;
  closingBalance: string;
  incomeByCategory: CategoryLine[];
  spendByCategory: CategoryLine[];
  /** The comparable previous period, for the change figures. */
  previous: {
    label: string;
    moneyIn: string;
    moneyOut: string;
    net: string;
  } | null;
};

export type MonthStat = {
  year: number;
  month: number;
  label: string;
  moneyIn: string;
  moneyOut: string;
  net: string;
  closingBalance: string;
  entries: number;
  /** Percent against the month before, or null when there is nothing to compare. */
  inChange: number | null;
  outChange: number | null;
};

export type BankStats = {
  year: number;
  currency: CurrencyView;
  fx: FxContext | null;
  accountName: string;
  months: MonthStat[];
  totals: { moneyIn: string; moneyOut: string; net: string };
  busiest: { label: string; entries: number } | null;
};

export type Remittance = {
  id: string;
  refNo: string;
  txnDate: string;
  description: string;
  accountName: string;
  /** What the CEO sent. */
  usdSent: string;
  /** What actually landed. */
  bdtReceived: string;
  /** bdtReceived / usdSent — the rate the transfer really achieved. */
  realisedRate: string;
  /** The market rate that day, when one is on record. */
  marketRate: string | null;
  /** What the bank kept, in BDT, when a market rate is known. */
  spread: string | null;
};

export type FundingReport = {
  from: string | null;
  to: string | null;
  remittances: Remittance[];
  totals: {
    usdSent: string;
    bdtReceived: string;
    /** Weighted, not an average of averages. */
    averageRate: string;
  };
};
