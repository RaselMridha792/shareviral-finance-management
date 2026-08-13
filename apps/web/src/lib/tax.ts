import type {
  AllocateDepositInput,
  CreateTdsDepositInput,
  FileReturnInput,
  FilingStatus,
  PendingItem,
  TdsDepositType,
} from "@finance/shared";

import { apiFetch } from "./api-client";

/**
 * Withholding only.
 *
 * There was an `incomeTaxApi` here as well. The income tax screen was retired
 * on the owner's instruction — TDS covers what this company needs — so the web
 * client for it went with the screen. The API still serves `/income-tax/*` and
 * the records are still in the database: bringing the screen back is a routing
 * change plus a client like the one below, not a rebuild.
 */

export type TdsMonthDto = {
  year: number;
  month: number;
  label: string;
  salaryTds: string;
  vendorTds: string;
  totalDeducted: string;
  deposited: string;
  outstanding: string;
  dueOn: string;
  deadlineLabel: string;
};

export type TdsLiabilityDto = {
  year: number;
  months: TdsMonthDto[];
  totals: { deducted: string; deposited: string; outstanding: string };
};

export type TdsDepositDto = {
  id: string;
  challanNumber: string;
  challanDate: string;
  depositDate: string;
  amount: string;
  bankName: string | null;
  branch: string | null;
  periodYear: number;
  periodMonth: number;
  periodLabel: string;
  depositType: TdsDepositType;
  transactionId: string | null;
  attachmentUrl: string | null;
  notes: string | null;
  allocatedCount: number;
};

export type TdsAllocationDto = {
  id: string;
  amount: string;
  payrollLineId: string | null;
  transactionId: string | null;
  personName: string | null;
  txnRefNo: string | null;
  txnDescription: string | null;
};

export type DepositDetailDto = {
  deposit: TdsDepositDto;
  allocations: TdsAllocationDto[];
  allocated: string;
  unallocated: string;
};

export type UnallocatedDto = {
  salaryLines: Array<{
    id: string;
    fullName: string;
    employeeCode: string;
    tdsAmount: string;
  }>;
  vendorPayments: Array<{
    id: string;
    refNo: string;
    description: string | null;
    txnDate: string;
    withheldTaxAmount: string | null;
  }>;
  total: string;
};

export type WithholdingReturnDto = {
  id: string;
  fiscalYear: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  dueDate: string;
  filedOn: string | null;
  acknowledgementNo: string | null;
  status: FilingStatus;
  notes: string | null;
  isOverdue: boolean;
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });
const fresh = { cache: "no-store" as const };

export const tdsApi = {
  liability: (year: number, month?: number) =>
    apiFetch<TdsLiabilityDto>(
      `/tds/liability?year=${year}${month ? `&month=${month}` : ""}`,
      fresh,
    ),
  deposits: (year?: number) =>
    apiFetch<{ items: TdsDepositDto[]; total: string }>(
      `/tds/deposits${year ? `?year=${year}` : ""}`,
      fresh,
    ),
  deposit: (id: string) =>
    apiFetch<DepositDetailDto>(`/tds/deposits/${id}`, fresh),
  createDeposit: (input: CreateTdsDepositInput) =>
    apiFetch<TdsDepositDto>("/tds/deposits", { method: "POST", ...json(input) }),
  allocate: (id: string, input: AllocateDepositInput) =>
    apiFetch<DepositDetailDto>(`/tds/deposits/${id}/allocations`, {
      method: "POST",
      ...json(input),
    }),
  unallocated: (year: number, month: number) =>
    apiFetch<UnallocatedDto>(
      `/tds/unallocated?year=${year}&month=${month}`,
      fresh,
    ),
  returns: (fiscalYear: number) =>
    apiFetch<WithholdingReturnDto[]>(
      `/tds/returns?fiscalYear=${fiscalYear}`,
      fresh,
    ),
  fileReturn: (id: string, input: FileReturnInput) =>
    apiFetch<{ filed: boolean; late: boolean }>(`/tds/returns/${id}/file`, {
      method: "POST",
      ...json(input),
    }),
  pending: (withinDays = 45) =>
    apiFetch<PendingItem[]>(`/tds/pending?withinDays=${withinDays}`, fresh),
};
