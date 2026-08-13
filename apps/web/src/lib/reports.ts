import type {
  BankStats,
  CurrencyView,
  FundingReport,
  Granularity,
  OverviewReport,
  PeriodReport,
  SetFxRateInput,
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
  }>;
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
};

export const fxApi = {
  rates: (limit = 90) =>
    apiFetch<FxRateDto[]>(`/fx/rates?limit=${limit}`, fresh),
  set: (input: SetFxRateInput) =>
    apiFetch<FxRateDto>("/fx/rates", { method: "POST", ...json(input) }),
};
