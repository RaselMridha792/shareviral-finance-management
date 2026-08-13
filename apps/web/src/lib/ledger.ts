import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  Paginated,
  PaymentMethod,
  TransferInput,
  TxnDirection,
  TxnOrigin,
  UpdateTransactionInput,
  VoidTransactionInput,
} from "@finance/shared";

import { API_BASE_URL, apiFetch } from "./api-client";

export type TransactionDto = {
  id: string;
  refNo: string;
  txnDate: string;
  direction: TxnDirection;
  amount: string;
  signedAmount: string;
  currency: string;
  description: string;
  notes: string | null;
  paymentMethod: PaymentMethod;
  reference: string | null;
  receiptUrl: string | null;
  billAmount: string | null;
  withheldTaxAmount: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  fxRate: string | null;
  createdVia: TxnOrigin;
  transferGroupId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  accountId: string;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  vendorId: string | null;
  vendorName: string | null;
  counterparty: string | null;
  createdAt: string;
};

export type RegisterRow = TransactionDto & { runningBalance: string };

export type RegisterResult = {
  account: {
    id: string;
    name: string;
    type: string;
    bankName: string | null;
    accountNumber: string | null;
    currency: string;
    openingBalance: string;
    openingBalanceOn: string;
  };
  openingBalance: string;
  totalIn: string;
  totalOut: string;
  closingBalance: string;
  rows: RegisterRow[];
};

export type LedgerSummary = {
  moneyIn: string;
  moneyOut: string;
  net: string;
  entries: number;
};

export type ExpenseGroup = {
  id: string;
  name: string;
  slug: string;
  color: string;
  total: string;
  entries: number;
};

export type ExpenseSummary = { groups: ExpenseGroup[]; total: string };

/** Drops empty values so the URL only carries filters that are actually set. */
export function toSearchParams(
  query: Record<string, string | number | boolean | undefined | null>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const ledgerApi = {
  list: (query: Partial<ListTransactionsQuery>) =>
    apiFetch<Paginated<TransactionDto>>(
      `/transactions?${toSearchParams(query)}`,
      { cache: "no-store" },
    ),

  summary: (query: Record<string, string | boolean | undefined>) =>
    apiFetch<LedgerSummary>(`/transactions/summary?${toSearchParams(query)}`, {
      cache: "no-store",
    }),

  register: (accountId: string, range: { from?: string; to?: string } = {}) =>
    apiFetch<RegisterResult>(
      `/accounts/${accountId}/register?${toSearchParams(range)}`,
      { cache: "no-store" },
    ),

  expenseSummary: (query: {
    from?: string;
    to?: string;
    categorySlug?: string;
  }) =>
    apiFetch<ExpenseSummary>(`/expenses/summary?${toSearchParams(query)}`, {
      cache: "no-store",
    }),

  create: (input: CreateTransactionInput) =>
    apiFetch<TransactionDto>("/transactions", { method: "POST", ...json(input) }),

  update: (id: string, input: UpdateTransactionInput) =>
    apiFetch<TransactionDto>(`/transactions/${id}`, {
      method: "PATCH",
      ...json(input),
    }),

  void: (id: string, input: VoidTransactionInput) =>
    apiFetch<TransactionDto>(`/transactions/${id}/void`, {
      method: "POST",
      ...json(input),
    }),

  transfer: (input: TransferInput) =>
    apiFetch<TransactionDto>("/transactions/transfer", {
      method: "POST",
      ...json(input),
    }),
};

/**
 * Excel downloads go straight to the browser rather than through `apiFetch`,
 * so the file is streamed and named by the server. The URL carries the same
 * filter the screen is showing.
 */
export function exportUrl(
  target: string,
  query: Record<string, string | number | boolean | undefined | null>,
): string {
  return `${API_BASE_URL}/exports/${target}?${toSearchParams(query)}`;
}
