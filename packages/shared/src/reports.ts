import { z } from "zod";

import { isoDateSchema, type FxReportBasis } from "./masters.ts";
import {
  checkPeriodIndex,
  granularitySchema,
  type Granularity,
} from "./periods.ts";

/* -------------------------------------------------------------------------- */
/*  Exchange rates                                                             */
/* -------------------------------------------------------------------------- */

export const FX_MODE_LABELS = {
  fixed: "One rate I set myself",
  live: "Fetched daily from a provider",
} as const;

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

export const periodQuerySchema = z
  .strictObject({
    granularity: granularitySchema.default("month"),
    /** The fiscal year's starting calendar year. */
    fiscalYear: z.coerce.number().int().min(2000).max(2200).optional(),
    /** Which period within that year: 1-12 for months, 1-4 quarters, 1-2 halves. */
    index: z.coerce.number().int().min(1).max(12).optional(),
    currency: currencyViewSchema.default("BDT"),
  })
  .superRefine(checkPeriodIndex);
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

/* -------------------------------------------------------------------------- */
/*  The overview                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything the first screen shows, in one request.
 *
 * Gathered server-side on purpose. The dashboard used to ask for each account's
 * register in turn, which is one query per account before a single figure
 * appears; this is a fixed number of queries whatever the company grows into.
 */
export const overviewQuerySchema = z
  .strictObject({
    granularity: granularitySchema.default("month"),
    fiscalYear: z.coerce.number().int().min(2000).max(2200).optional(),
    index: z.coerce.number().int().min(1).max(12).optional(),
    currency: currencyViewSchema.default("BDT"),
  })
  .superRefine(checkPeriodIndex);
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

/**
 * One block of four figures on the dashboard: where an account started, what
 * moved through it, where it stands.
 *
 * Grouped by what the money *is* rather than by account row. The taka accounts
 * are one position — the bank and the petty cash tin are both company cash in
 * taka — while the prepaid card is a different thing entirely, held in dollars
 * and spent on tooling. Summing the two together would produce a number that
 * is wrong by the exchange rate and reads as perfectly normal.
 */
export type AccountGroup = {
  key: "bank" | "card";
  label: string;
  /** The accounts folded into this block, so the reader knows what is in it. */
  accounts: string[];
  currency: string;
  opening: string;
  moneyIn: string;
  moneyOut: string;
  closing: string;
  /** The same four in dollars, approximate, at the month's rate. */
  usd: {
    opening: string | null;
    moneyIn: string | null;
    moneyOut: string | null;
    closing: string | null;
  };
};

/** The three or four figures under "Expense overview". */
export type ExpenseOverview = {
  salaryPaid: string;
  /** Subscriptions, AI tools, hosting — and anything settled on the card. */
  toolsAndSubscriptions: string;
  taxWithheld: string;
  taxOutstanding: string;
  usd: {
    salaryPaid: string | null;
    toolsAndSubscriptions: string | null;
    taxWithheld: string | null;
    taxOutstanding: string | null;
  };
};

export type OverviewTotals = {
  moneyIn: string;
  moneyOut: string;
  net: string;
  entries: number;
  /** Every account's opening balance plus everything that has moved. Not period-bound. */
  cashInHand: string;
  /** Net pay that actually left the bank in this period. */
  salaryPaid: string;
  /** BDT that landed from the CEO's remittances in this period. */
  fundingReceived: string;
  /** Tax held back from payments in this period. */
  taxWithheld: string;
  /** Deposited by challan in this period. */
  taxDeposited: string;
  /** Held back and not yet deposited, all time — an obligation, not a period figure. */
  taxOutstanding: string;
};

export type OverviewVendor = {
  name: string;
  total: string;
  entries: number;
};

export type OverviewEntry = {
  id: string;
  refNo: string;
  txnDate: string;
  description: string;
  direction: "in" | "out";
  amount: string;
  categoryName: string | null;
  vendorName: string | null;
  accountName: string | null;
};

/**
 * Which of the three possible rates a period ended up being read at.
 *
 * Carried to the screen so a reader can tell why the figure is what it is —
 * particularly why editing the Settings rate did not move a month that was
 * funded, which is the correct behaviour and looks like a bug without this.
 */
export const GOVERNING_RATE_SOURCES = ["funding", "settings", "table"] as const;
export type GoverningRateSource = (typeof GOVERNING_RATE_SOURCES)[number];

export const GOVERNING_RATE_LABELS: Record<GoverningRateSource, string> = {
  funding: "the rate this month was funded at",
  settings: "the rate set in Settings",
  table: "the recorded rate for this period",
};

export type OverviewReport = {
  period: {
    label: string;
    start: string;
    end: string;
    granularity: Granularity;
  };
  currency: CurrencyView;
  fx: FxContext | null;
  /**
   * The rate every dollar figure on this screen was produced at — the month's
   * funding rate where there was one. Null when nothing could be converted,
   * and the dollar lines are then absent rather than guessed.
   */
  usdRate: string | null;
  /** Where that rate came from. Null exactly when `usdRate` is. */
  usdRateSource: GoverningRateSource | null;
  totals: OverviewTotals;
  /** Bank and card, each with its own opening, movement and closing. */
  groups: AccountGroup[];
  expense: ExpenseOverview;
  /** The comparable period before, for the change figures. */
  previous: {
    label: string;
    moneyIn: string;
    moneyOut: string;
    net: string;
    salaryPaid: string;
    fundingReceived: string;
  } | null;
  /** Twelve months to the end of the period, for the trend. */
  months: MonthStat[];
  spendByCategory: CategoryLine[];
  incomeByCategory: CategoryLine[];
  topVendors: OverviewVendor[];
  balances: Array<{
    id: string;
    name: string;
    type: string;
    currency: string;
    balance: string;
  }>;
  recent: OverviewEntry[];
  headcount: { employees: number; contractors: number };
};

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
