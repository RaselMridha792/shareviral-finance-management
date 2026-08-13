import type {
  BloodGroup,
  CreatePayrollRunInput,
  CreateTeamMemberInput,
  EducationLevel,
  EmploymentStatus,
  EngagementType,
  Gender,
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

/**
 * What the team screens read.
 *
 * The company's employee sheet, plus what the app itself needs: a code, an
 * engagement type, a status, and the bank / e-TIN details payroll and
 * withholding depend on. The API still returns a handful of columns that are
 * retained but no longer collected — marital status, parents' names, emergency
 * contact and the rest — and they are deliberately absent here: nothing on
 * screen shows them, so nothing on screen should be typed for them.
 */
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

  /* --- who they are ------------------------------------------------------ */

  /** A link (Drive or any https URL). The app stores no files. */
  photoUrl: string | null;
  /** The sheet's Age column is worked out from this, not stored. */
  dateOfBirth: string | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;

  /** `address` above is the present one; this is the permanent one. */
  permanentAddress: string | null;

  /* --- the shape of the job ---------------------------------------------- */

  /**
   * The figure agreed at hire — the one salary anyone with `team.read` sees.
   * What they are paid now is `CompensationDto`, behind its own permission.
   */
  joiningSalary: string | null;

  educationLevel: EducationLevel | null;
  educationMajor: string | null;

  /* --- papers on file ----------------------------------------------------- */

  /** Links, like `photoUrl`. Nothing is uploaded to this app. */
  cvUrl: string | null;
  appointmentLetterUrl: string | null;
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

/**
 * A payslip as it appears in a list on somebody's profile — the month, the
 * three figures worth scanning, and the line id that opens the slip itself.
 *
 * Not `PayrollLineDto`: that shape carries the bank account, the e-TIN and the
 * frozen snapshots, none of which a list needs and all of which would then be
 * on a page that only had to show twelve rows of gross, tax and net.
 */
export type MemberPayslipDto = {
  id: string;
  runId: string;
  runLabel: string;
  runStatus: PayrollStatus;
  periodYear: number;
  periodMonth: number;
  grossAmount: string;
  tdsAmount: string;
  netAmount: string;
  isPaid: boolean;
  paidOn: string | null;
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

  /**
   * One person's payslips, finalised runs only, newest first.
   *
   * Gated on `payroll.read` like the payslip itself — HR gets a 403, not an
   * empty list, so the profile page must not call this without checking.
   */
  memberPayslips: (teamMemberId: string) =>
    apiFetch<MemberPayslipDto[]>(
      `/payroll/members/${teamMemberId}/payslips`,
      { cache: "no-store" },
    ),
};
