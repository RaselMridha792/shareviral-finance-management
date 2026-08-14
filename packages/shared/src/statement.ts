import { z } from "zod";

import { isoDateSchema } from "./masters.ts";
import { checkPeriodIndex, granularitySchema } from "./periods.ts";

/**
 * The financial statement — the document this company was producing by hand
 * before the app existed.
 *
 * It is not the same thing as the reports screen. A report answers a question;
 * a statement is a *position*, signed off, with every figure reconciled back
 * to a closing balance and notes explaining the parts a number cannot. The
 * shape below follows the document section for section, because the point is
 * to stop somebody rebuilding it in a spreadsheet each month.
 *
 * Two things it does that the rest of the app deliberately does not:
 *
 * Every figure carries **both** currencies. Elsewhere USD is a view you switch
 * to, precisely so a translated number is never mistaken for a recorded one.
 * Here both sit side by side because the reader is a CFO in Dhaka and a CFO in
 * the USA looking at the same page.
 *
 * And the rate belongs to **each entry**, captured on the day it happened, not
 * to the account and not to the period. The bank moved at ৳122.77 and the
 * prepaid card at ৳123.00 in the same month; a single rate applied afterwards
 * would put a wrong dollar figure beside half the lines and nothing on the
 * page would say so. Asking once, at the moment somebody is already typing the
 * amount, is the only time the right answer is actually known.
 */

export const statementQuerySchema = z
  .strictObject({
    granularity: granularitySchema.default("month"),
    fiscalYear: z.coerce.number().int().min(2000).max(2200).optional(),
    index: z.coerce.number().int().min(1).max(12).optional(),
  })
  .superRefine(checkPeriodIndex);
export type StatementQuery = z.infer<typeof statementQuerySchema>;

/**
 * A figure in both currencies.
 *
 * `rate` is the one this line's dollars came from — the rate recorded against
 * that entry on the day. Null means no rate was captured and the dollar figure
 * is missing rather than guessed: a blank is honest, a number produced from
 * whatever rate happened to be lying around is not.
 */
export type Money2 = {
  bdt: string;
  usd: string | null;
  rate: string | null;
  /**
   * True when the dollars came from a period fallback rather than the entry's
   * own rate. The document marks these so a reader knows which is which.
   */
  estimated?: boolean;
};

export type StatementLine = {
  label: string;
  /** The small grey line under the label. */
  detail: string | null;
  amount: Money2;
};

/** 01 — the four measures and where the period closed. */
export type ExecutiveSummary = {
  lines: Array<StatementLine & { basis: "Inflow" | "Outflow" | "Card" }>;
  closing: {
    bank: Money2;
    card: Money2 | null;
  };
};

/**
 * 02 — what the closing bank balance is actually made of.
 *
 * The distinction the old spreadsheet made and no accounting screen does:
 * money held against a tax liability is in the account but is not the
 * company's to spend, and money received this month for next month's payroll
 * is not this month's surplus.
 */
export type CashComposition = {
  free: Money2;
  /** Withheld tax sitting in the account, not yet handed to the treasury. */
  restricted: Money2;
  /** Part of `free`, received this period but earmarked for the next. */
  committedForward: Money2 | null;
  committedForwardNote: string | null;
  total: Money2;
};

/** 03 — opening, each movement, closing. Drawn as a waterfall. */
export type WaterfallStep = {
  label: string;
  /** Positive rises, negative falls, null for the opening and closing pillars. */
  delta: Money2 | null;
  /** Where the balance stands after this step. */
  balance: Money2;
  kind: "opening" | "in" | "out" | "closing";
};

export type OutflowShare = {
  label: string;
  amount: Money2;
  /** Percent of the period's total outflow. */
  share: number;
  color: string | null;
};

/** 04 and 05 — one per account, line by line with a running balance. */
export type AccountLedger = {
  accountId: string;
  name: string;
  /** "Bangladesh Bank", "Prepaid · AI tooling". */
  subtitle: string | null;
  currency: string;
  /** The range of rates seen on this account's entries this period. */
  rateFrom: string | null;
  rateTo: string | null;
  opening: Money2;
  closing: Money2;
  rows: Array<{
    id: string | null;
    label: string;
    detail: string | null;
    direction: "in" | "out";
    amount: Money2;
    balance: Money2;
  }>;
};

export type StatementSignatory = {
  name: string;
  title: string;
};

export type FinancialStatement = {
  period: {
    label: string;
    start: string;
    end: string;
    granularity: string;
    /** "07" for July, "Q1", "H1", "FY" — the big numeral on the page. */
    ordinal: string;
  };
  company: {
    name: string;
    counterparty: string | null;
  };
  /** "2026 · Cycle 03". Counts statements within the financial year. */
  cycle: number;
  status: "draft" | "reconciled";
  audited: boolean;
  lineItems: number;

  summary: ExecutiveSummary;
  composition: CashComposition;
  waterfall: WaterfallStep[];
  outflow: {
    total: Money2;
    shares: OutflowShare[];
  };
  ledgers: AccountLedger[];
  /** Prose. Written by a person; the app supplies a first draft. */
  notes: string[];
  signatories: StatementSignatory[];
  generatedOn: string;
};

/* -------------------------------------------------------------------------- */
/*  Saving the parts a ledger cannot derive                                    */
/* -------------------------------------------------------------------------- */

/**
 * Notes, signatories and the reconciled flag are per period and per company,
 * not per transaction. They are the reason the old version of this document
 * lived in a word processor.
 */
export const saveStatementSchema = z.strictObject({
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  notes: z.array(z.string().trim().max(600)).max(30).optional(),
  status: z.enum(["draft", "reconciled"]).optional(),
  audited: z.boolean().optional(),
  cycle: z.coerce.number().int().min(1).max(99).optional(),
  signatories: z
    .array(
      z.strictObject({
        name: z.string().trim().min(2).max(80),
        title: z.string().trim().min(2).max(120),
      }),
    )
    .max(4)
    .optional(),
  /**
   * Received in this period, spent in the next. Recorded against the inflow
   * itself so the note and the figure cannot drift apart.
   */
  committedForwardTxnIds: z.array(z.string().uuid()).max(50).optional(),
});
export type SaveStatementInput = z.infer<typeof saveStatementSchema>;
