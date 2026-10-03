import type { Paginated } from "@finance/shared";

import { apiFetch } from "./api-client";

/**
 * HR Requests (#125): every money request from the HR portal — a pay
 * change, a one-off, a budget, a spend — and finance's decision on it.
 * Shapes are `apps/api/src/modules/hr-requests/hr-requests.service.ts`.
 */

export type RequestKind = "pay_change" | "one_off" | "budget" | "spend";
export type RequestState =
  "pending" | "held" | "approved" | "rejected" | "withdrawn";
/** As stored — what a decision sends. `received` is "back to waiting". */
export type Decision = "approved" | "refused" | "held" | "received";
/** `to_pay`: spends approved and not yet paid. `approved` includes them. */
export type StateFilter =
  | "waiting"
  | "pending"
  | "held"
  | "to_pay"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "all";

export type HrRequestDto = {
  kind: RequestKind;
  id: string;
  externalId: string | null;
  subject: string;
  teamMemberId: string | null;
  amount: string;
  effectiveOn: string;
  monthKey: string;
  detail: string | null;
  requestedByName: string | null;
  hrApprovedByName: string | null;
  hrApprovedAt: string | null;
  hrNote: string | null;
  status: string;
  state: RequestState;
  paid: boolean;
  note: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  beforeApprovals: boolean;
  sendCount: number;
  receivedAt: string;
};

export type HrRequestDetailDto = HrRequestDto & {
  previousAmount: string | null;
  /**
   * A pay change: the figure on file for its date and when that figure
   * starts, the one in force today, and the next change after its date.
   */
  onFileAmount: string | null;
  onFileFrom: string | null;
  currentAmount: string | null;
  nextChangeOn: string | null;
  sheets: { label: string; status: string }[];
  budget: {
    categoryName: string | null;
    startsOn: string | null;
    endsOn: string | null;
    status: string | null;
    amount: string | null;
    spent: string | null;
    paid: string | null;
    spendCount: number;
  } | null;
  transactionRef: string | null;
  history: { at: string; summary: string; byName: string | null }[];
};

export type HrRequestList = Paginated<HrRequestDto> & {
  counts: {
    waiting: number;
    to_pay: number;
    approved: number;
    rejected: number;
    withdrawn: number;
    all: number;
  };
};

export const KIND_LABELS: Record<RequestKind, string> = {
  pay_change: "Pay change",
  one_off: "One-off",
  budget: "Budget",
  spend: "Spend",
};

export const hrRequestsApi = {
  list: (query: {
    page: number;
    state: StateFilter;
    kind?: RequestKind;
    month?: string;
    q?: string;
  }) => {
    const params = new URLSearchParams({
      page: String(query.page),
      state: query.state,
    });
    if (query.kind) params.set("kind", query.kind);
    if (query.month) params.set("month", query.month);
    if (query.q) params.set("q", query.q);
    return apiFetch<HrRequestList>(`/hr-requests?${params}`, {
      cache: "no-store",
    });
  },
  get: (kind: RequestKind, id: string) =>
    apiFetch<HrRequestDetailDto>(`/hr-requests/${kind}/${id}`, {
      cache: "no-store",
    }),
  waiting: () =>
    apiFetch<{ waiting: number }>("/hr-requests/waiting", {
      cache: "no-store",
    }),
  decide: (
    kind: RequestKind,
    id: string,
    decision: Decision,
    note: string | null,
  ) =>
    apiFetch<{ request: HrRequestDetailDto; notice: string | null }>(
      `/hr-requests/${kind}/${id}/decision`,
      { method: "POST", body: JSON.stringify({ decision, note }) },
    ),
};
