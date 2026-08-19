import type {
  AllocateDepositInput,
  CreateTdsDepositInput,
  FileReturnInput,
  FilingStatus,
  Granularity,
  PendingItem,
  SalaryTdsRegister,
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
 *
 * Since the withholding screen was cut down to the salary register, the same is
 * true of most of what is below: `liability`, `deposits`, `deposit`,
 * `createDeposit`, `allocate`, `unallocated`, `returns` and `fileReturn` have
 * no caller in the app today. They stay because the challans and the quarterly
 * returns are this company's compliance trail — the records are still written
 * and the endpoints still answer, and the page that reads them again will want
 * this client rather than a second one.
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
  /**
   * Deposited beyond what was withheld. `outstanding` is clamped at zero, so
   * without this a month that was over-deposited is indistinguishable from one
   * that was settled exactly.
   */
  overDeposited: string;
  dueOn: string;
  deadlineLabel: string;
};

export type TdsLiabilityDto = {
  year: number;
  months: TdsMonthDto[];
  totals: {
    deducted: string;
    deposited: string;
    outstanding: string;
    overDeposited: string;
  };
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
  /**
   * Whose salary was taxed over a period, and by how much.
   *
   * The period is named the way every report names one — a granularity, a
   * financial year and an index into it — rather than as two dates. Every part
   * of it is optional, and asking for none of it answers with the period we are
   * in, which is what the screen wants on its first paint.
   */
  salaryRegister: (
    params: {
      granularity?: Granularity;
      fiscalYear?: number;
      index?: number;
    } = {},
  ) => {
    const search = new URLSearchParams();
    if (params.granularity) search.set("granularity", params.granularity);
    if (params.fiscalYear) search.set("fiscalYear", String(params.fiscalYear));
    if (params.index) search.set("index", String(params.index));
    const query = search.toString();

    return apiFetch<SalaryTdsRegister>(
      `/tds/salary-deductions${query ? `?${query}` : ""}`,
      fresh,
    );
  },
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
    apiFetch<TdsDepositDto>("/tds/deposits", {
      method: "POST",
      ...json(input),
    }),
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
