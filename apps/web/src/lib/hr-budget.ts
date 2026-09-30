import type { Paginated } from "@finance/shared";

import { PAGE_SIZE } from "@/lib/pagination";

import { apiFetch } from "./api-client";

/**
 * HR Budget (#121) — `apps/api/src/modules/hr-budget`. What the HR portal
 * sends, as the page reads and decides it. A file of its own: nothing else in
 * the app reads these.
 */

export type PeriodStatus = "received" | "approved" | "refused";
export type SpendStatus = "received" | "approved" | "refused" | "paid";

export type HrBudgetPeriodDto = {
  id: string;
  externalId: string;
  categoryName: string;
  startsOn: string;
  endsOn: string;
  amount: string;
  note: string | null;
  recordedByName: string;
  status: PeriodStatus;
  statusNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  sendCount: number;
  receivedAt: string;
  updatedAt: string;
  spendCount: number;
  /** Every spend against it not refused, summed on the server. */
  spentAmount: string;
  paidAmount: string;
};

export type HrBudgetSpendDto = {
  id: string;
  externalId: string;
  budgetExternalId: string;
  budgetKnown: boolean;
  spentOn: string;
  amount: string;
  purpose: string;
  teamMemberId: string | null;
  teamMemberName: string | null;
  employeeName: string | null;
  hrStatus: "proposed" | "approved";
  hrApprovedByName: string | null;
  hrApprovedAt: string | null;
  recordedByName: string;
  hasReceipt: boolean;
  status: SpendStatus;
  statusNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  paidOn: string | null;
  sendCount: number;
  receivedAt: string;
  updatedAt: string;
  categoryName: string | null;
  budgetStartsOn: string | null;
  budgetEndsOn: string | null;
  budgetStatus: PeriodStatus | null;
  transactionId: string | null;
  transactionRef: string | null;
};

export type Decision = "approved" | "refused" | "received";

export type PaySpendInput = {
  accountId: string;
  categoryId: string;
  txnDate: string;
  usdRate: string;
  description: string;
  notes: string | null;
};

function query(input: Record<string, string | number | undefined>) {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const hrBudgetApi = {
  periods: (input: { page?: number; status?: PeriodStatus; q?: string }) =>
    apiFetch<Paginated<HrBudgetPeriodDto>>(
      `/hr-budget/periods?${query(input)}`,
      { cache: "no-store" },
    ),
  spends: (input: {
    page?: number;
    status?: SpendStatus;
    q?: string;
    budgetExternalId?: string;
  }) =>
    apiFetch<Paginated<HrBudgetSpendDto>>(`/hr-budget/spends?${query(input)}`, {
      cache: "no-store",
    }),
  decidePeriod: (id: string, decision: Decision, note: string | null) =>
    apiFetch<unknown>(`/hr-budget/periods/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  decideSpend: (id: string, decision: Decision, note: string | null) =>
    apiFetch<unknown>(`/hr-budget/spends/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),
  /** Answers with the entry it wrote, to file the papers on (#122). */
  paySpend: (id: string, input: PaySpendInput) =>
    apiFetch<{ transactionId: string; transactionRef: string }>(
      `/hr-budget/spends/${id}/pay`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
};
