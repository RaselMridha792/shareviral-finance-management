import type {
  CreatePayrollRunInput,
  CreateTeamMemberInput,
  EmploymentStatus,
  EngagementType,
  Paginated,
  PaymentMode,
  PayPayrollInput,
  PayrollStatus,
  PsrStatus,
  SetCompensationInput,
  UpdatePayrollLineInput,
  UpdateTeamMemberInput,
} from "@finance/shared";

import { apiFetch } from "./api-client";

export type TeamMemberDto = {
  id: string;
  employeeCode: string;
  fullName: string;
  engagementType: EngagementType;
  department: string | null;
  designation: string | null;
  joinedOn: string;
  endedOn: string | null;
  status: EmploymentStatus;
  personalEmail: string | null;
  workEmail: string | null;
  phone: string | null;
  nid: string | null;
  etin: string | null;
  psrStatus: PsrStatus;
  psrAssessmentYear: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankRouting: string | null;
  walletProvider: string | null;
  walletNumber: string | null;
  address: string | null;
  notes: string | null;
};

export type CompensationDto = {
  id: string;
  grossAmount: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string | null;
  createdAt: string;
};

export type PayrollRunDto = {
  id: string;
  periodYear: number;
  periodMonth: number;
  label: string;
  status: PayrollStatus;
  paymentMode: PaymentMode;
  accountId: string | null;
  paymentDate: string | null;
  totalGross: string;
  totalAdditions: string;
  totalTds: string;
  totalDeductions: string;
  totalNet: string;
  notes: string | null;
  finalizedAt: string | null;
};

export type PayrollLineDto = {
  id: string;
  teamMemberId: string;
  employeeCode: string;
  fullName: string;
  engagementType: EngagementType;
  grossAmount: string;
  bonusAmount: string;
  otherAdditions: string;
  tdsAmount: string;
  otherDeductions: string;
  deductionNote: string | null;
  netAmount: string;
  isPaid: boolean;
  paidOn: string | null;
  transactionId: string | null;
  snapshotDesignation: string | null;
  snapshotDepartment: string | null;
  snapshotBankName: string | null;
  snapshotBankAccount: string | null;
  snapshotEtin: string | null;
  remarks: string | null;
};

export type PayslipDto = PayrollLineDto & {
  runId: string;
  runLabel: string;
  runStatus: PayrollStatus;
  paymentMethod: string;
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const teamApi = {
  list: (params: { page?: number; q?: string; status?: string; engagementType?: string } = {}) => {
    const search = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: "100",
    });
    if (params.q) search.set("q", params.q);
    if (params.status) search.set("status", params.status);
    if (params.engagementType)
      search.set("engagementType", params.engagementType);
    return apiFetch<Paginated<TeamMemberDto>>(`/team-members?${search}`, {
      cache: "no-store",
    });
  },
  get: (id: string) =>
    apiFetch<TeamMemberDto>(`/team-members/${id}`, { cache: "no-store" }),
  create: (input: CreateTeamMemberInput) =>
    apiFetch<TeamMemberDto>("/team-members", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateTeamMemberInput) =>
    apiFetch<TeamMemberDto>(`/team-members/${id}`, {
      method: "PATCH",
      ...json(input),
    }),

  /** Separately gated — HR gets a 403 here. */
  compensation: (id: string) =>
    apiFetch<CompensationDto[]>(`/team-members/${id}/compensation`, {
      cache: "no-store",
    }),
  setCompensation: (id: string, input: SetCompensationInput) =>
    apiFetch<CompensationDto>(`/team-members/${id}/compensation`, {
      method: "POST",
      ...json(input),
    }),
};

export const payrollApi = {
  listRuns: (page = 1) =>
    apiFetch<Paginated<PayrollRunDto>>(
      `/payroll/runs?page=${page}&pageSize=24`,
      { cache: "no-store" },
    ),
  getRun: (id: string) =>
    apiFetch<{ run: PayrollRunDto; lines: PayrollLineDto[] }>(
      `/payroll/runs/${id}`,
      { cache: "no-store" },
    ),
  createRun: (input: CreatePayrollRunInput) =>
    apiFetch<PayrollRunDto>("/payroll/runs", { method: "POST", ...json(input) }),
  generateLines: (id: string) =>
    apiFetch<{ created: number; skipped: string[]; message?: string }>(
      `/payroll/runs/${id}/generate-lines`,
      { method: "POST" },
    ),
  updateLine: (id: string, input: UpdatePayrollLineInput) =>
    apiFetch<{ updated: boolean; warning?: string }>(`/payroll/lines/${id}`, {
      method: "PATCH",
      ...json(input),
    }),
  finalize: (id: string) =>
    apiFetch<{ run: PayrollRunDto; lines: PayrollLineDto[] }>(
      `/payroll/runs/${id}/finalize`,
      { method: "POST" },
    ),
  reopen: (id: string) =>
    apiFetch<{ run: PayrollRunDto; lines: PayrollLineDto[] }>(
      `/payroll/runs/${id}/reopen`,
      { method: "POST" },
    ),
  pay: (id: string, input: PayPayrollInput) =>
    apiFetch<{ run: PayrollRunDto; lines: PayrollLineDto[] }>(
      `/payroll/runs/${id}/pay`,
      { method: "POST", ...json(input) },
    ),
  payslip: (lineId: string) =>
    apiFetch<PayslipDto>(`/payroll/lines/${lineId}/payslip`, {
      cache: "no-store",
    }),
};
