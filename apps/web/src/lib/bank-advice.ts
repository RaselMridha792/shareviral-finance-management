import type { Paginated } from "@finance/shared";

import { PAGE_SIZE } from "@/lib/pagination";

import { API_BASE_URL, apiFetch } from "./api-client";

/**
 * Bank advices (#119) — `apps/api/src/modules/bank-advices`.
 *
 * A new file rather than lines in `payroll.ts` or `api-client.ts`: nothing
 * else reads these, and a screen of its own should not widen a file other
 * screens import.
 */

export const PAYMENT_TYPES = ["PAY", "ACH", "BT", "RTGS"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

/** What each payment type means, as the bank's instructions put it. */
export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  PAY: "PAY — payroll (salary)",
  ACH: "ACH — BEFTN, another bank",
  BT: "BT — SCB to SCB",
  RTGS: "RTGS — real-time, another bank",
};

export const SCB_CODE = "SCBLBDDXXXX";

export type BankAdviceRowDto = {
  id: string;
  title: string;
  payrollRunId: string | null;
  runLabel: string | null;
  accountId: string | null;
  accountName: string | null;
  debitAccountNo: string;
  debitCityCode: string;
  valueDate: string;
  note: string | null;
  lineCount: number;
  incompleteCount: number;
  totalAmount: string;
  downloadedAt: string | null;
  downloadedByName: string | null;
  createdAt: string;
  createdByName: string | null;
};

export type BankAdviceLineDto = {
  id: string;
  position: number;
  paymentType: PaymentType;
  beneficiaryName: string;
  bankCode: string;
  accountNo: string;
  paymentDetails: string;
  currency: string;
  amount: string;
  email: string | null;
  teamMemberId: string | null;
  payrollLineId: string | null;
  problems: string[];
};

export type BankAdviceDto = BankAdviceRowDto & {
  lines: BankAdviceLineDto[];
  problems: string[];
};

export type LineInput = {
  paymentType: PaymentType;
  beneficiaryName: string;
  bankCode: string;
  accountNo: string;
  paymentDetails: string;
  amount: string;
  email: string | null;
};

export type AdviceInput = {
  title: string;
  accountId: string | null;
  debitAccountNo?: string;
  debitCityCode: string;
  valueDate: string;
  note: string | null;
};

export type FromPayrollInput = {
  payrollRunId: string;
  valueDate: string;
  paymentDetails: string;
  paymentType: PaymentType;
  accountId?: string;
  includeEmails: boolean;
  title?: string;
};

export const bankAdviceApi = {
  list: (input: { page?: number; q?: string } = {}) => {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (input.page) params.set("page", String(input.page));
    if (input.q) params.set("q", input.q);
    return apiFetch<Paginated<BankAdviceRowDto>>(
      `/bank-advices?${params.toString()}`,
      { cache: "no-store" },
    );
  },
  get: (id: string) =>
    apiFetch<BankAdviceDto>(`/bank-advices/${id}`, { cache: "no-store" }),
  fromPayroll: (input: FromPayrollInput) =>
    apiFetch<{
      advice: BankAdviceDto;
      skipped: { name: string; reason: string }[];
    }>("/bank-advices/from-payroll", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  create: (input: AdviceInput) =>
    apiFetch<BankAdviceDto>("/bank-advices", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: AdviceInput) =>
    apiFetch<BankAdviceDto>(`/bank-advices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  addLine: (id: string, input: LineInput) =>
    apiFetch<BankAdviceDto>(`/bank-advices/${id}/lines`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateLine: (id: string, lineId: string, input: LineInput) =>
    apiFetch<BankAdviceDto>(`/bank-advices/${id}/lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeLine: (id: string, lineId: string) =>
    apiFetch<BankAdviceDto>(`/bank-advices/${id}/lines/${lineId}`, {
      method: "DELETE",
    }),
  /** Where the browser fetches the file itself — a download, not JSON. */
  fileUrl: (id: string, kind: "csv" | "xlsx") =>
    `${API_BASE_URL}/bank-advices/${id}/${kind}`,
};
