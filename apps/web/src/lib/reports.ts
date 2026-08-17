import type {
  BankStats,
  CurrencyView,
  FinancialStatement,
  FundingReport,
  Granularity,
  OverviewReport,
  PeriodReport,
  SaveStatementInput,
  SetFxRateInput,
  StatementSignatory,
} from "@finance/shared";

import { apiFetch } from "./api-client";

export type AvailablePeriods = {
  fiscalYearMode: "bd_july_june" | "calendar";
  years: number[];
  periods: Array<{
    index: number;
    label: string;
    start: string;
    end: string;
    /**
     * Whether this period can be chosen at all.
     *
     * False for one that has not happened yet and one from before the books
     * begin. The server decides it, because "has September happened" depends on
     * the clock and a browser set to UTC is six hours behind Dhaka. The picker
     * greys it out rather than dropping it: not offered is a different thing
     * from not there.
     */
    selectable: boolean;
  }>;
};

/**
 * What a save answers with: the stored row, not the rebuilt statement. The
 * derived figures come from the ledger, so there is nothing in them for a save
 * to change — callers that want the whole document ask for it again.
 */
export type SavedStatement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  cycle: number;
  status: "draft" | "reconciled";
  audited: boolean;
  notes: string[];
  signatories: StatementSignatory[];
  committedForwardTxnIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type FxRateDto = {
  id: string;
  rate: string;
  rateDate: string;
  source: "manual" | "api";
  provider: string | null;
  notes: string | null;
};

const fresh = { cache: "no-store" as const };
const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const reportsApi = {
  /** The whole overview screen, in one request. */
  overview: (params: {
    granularity: Granularity;
    fiscalYear?: number;
    index?: number;
    currency?: CurrencyView;
  }) => {
    const search = new URLSearchParams({ granularity: params.granularity });
    if (params.fiscalYear) search.set("fiscalYear", String(params.fiscalYear));
    if (params.index) search.set("index", String(params.index));
    if (params.currency) search.set("currency", params.currency);
    return apiFetch<OverviewReport>(`/reports/overview?${search}`, fresh);
  },

  periods: (granularity: Granularity) =>
    apiFetch<AvailablePeriods>(
      `/reports/periods?granularity=${granularity}`,
      fresh,
    ),

  period: (params: {
    granularity: Granularity;
    fiscalYear?: number;
    index?: number;
    currency?: CurrencyView;
  }) => {
    const search = new URLSearchParams({ granularity: params.granularity });
    if (params.fiscalYear) search.set("fiscalYear", String(params.fiscalYear));
    if (params.index) search.set("index", String(params.index));
    if (params.currency) search.set("currency", params.currency);
    return apiFetch<PeriodReport>(`/reports/period?${search}`, fresh);
  },

  bankStats: (params: {
    year: number;
    accountId?: string;
    currency?: CurrencyView;
  }) => {
    const search = new URLSearchParams({ year: String(params.year) });
    if (params.accountId) search.set("accountId", params.accountId);
    if (params.currency) search.set("currency", params.currency);
    return apiFetch<BankStats>(`/reports/bank-stats?${search}`, fresh);
  },

  funding: (params: { from?: string; to?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    return apiFetch<FundingReport>(`/reports/funding?${search}`, fresh);
  },

  /**
   * The signed document, not a report: one period, both currencies on every
   * figure, reconciled back to a closing balance.
   */
  statement: (params: {
    granularity: Granularity;
    fiscalYear?: number;
    index?: number;
  }) => {
    const search = new URLSearchParams({ granularity: params.granularity });
    if (params.fiscalYear) search.set("fiscalYear", String(params.fiscalYear));
    if (params.index) search.set("index", String(params.index));
    return apiFetch<FinancialStatement>(`/reports/statement?${search}`, fresh);
  },

  /**
   * The parts of the statement a ledger cannot derive — the notes somebody
   * wrote, the cycle number, whether it has been reconciled, and who signs it.
   */
  saveStatement: (input: SaveStatementInput) =>
    apiFetch<SavedStatement>("/reports/statement", {
      method: "PATCH",
      ...json(input),
    }),
};

export const fxApi = {
  rates: (limit = 90) =>
    apiFetch<FxRateDto[]>(`/fx/rates?limit=${limit}`, fresh),
  set: (input: SetFxRateInput) =>
    apiFetch<FxRateDto>("/fx/rates", { method: "POST", ...json(input) }),
};
