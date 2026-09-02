import type {
  BloodGroup,
  CreatePayrollRunInput,
  CreateTeamMemberInput,
  EducationLevel,
  EmploymentStatus,
  EmploymentType,
  EngagementType,
  TdsBasis,
  Gender,
  Paginated,
  PaymentMode,
  PayPayrollInput,
  PayrollStatus,
  PsrStatus,
  SetCompensationInput,
  SetTeamSocialsInput,
  UpsertEreturnInput,
  SocialPlatform,
  UpdatePayrollLineInput,
  UpdateTeamMemberInput,
} from "@finance/shared";
import { PAGE_SIZE } from "@/lib/pagination";

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
  /** The company's own identifier, when they have one. */
  employeeCode: string | null;
  fullName: string;
  engagementType: EngagementType;
  /**
   * Where and on what footing they work — null until somebody says.
   *
   * Not the same field as `engagementType` above and not derived from it: that
   * one decides whether payroll draws them, this one is the employment record.
   * The only overlap is that every contractor was backfilled to `contractual`,
   * which is the same fact under a second name.
   */
  employmentType: EmploymentType | null;
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
  /** The name on the account, which is not always the employee's own. */
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankBranch: string | null;
  bankRouting: string | null;
  bankSwift: string | null;
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

  /**
   * Google Drive links, from before this app held files of its own.
   *
   * They still work and are still shown when a record has one. Uploaded
   * documents are a separate list, fetched from `/files/team-member/:id` —
   * separate because a document that names a salary needs its own permission,
   * and that decision belongs on the request rather than in this shape.
   */
  cvUrl: string | null;
  appointmentLetterUrl: string | null;

  /**
   * The uploaded photograph, when there is one.
   *
   * Optional rather than nullable: the create and update responses do not
   * report it, because it is read with a subquery the API's `returning()`
   * cannot run. Every read — the directory and the profile — carries it.
   */
  photoFileId?: string | null;
};

export type CompensationDto = {
  id: string;
  grossAmount: string;
  /**
   * How that gross divides — Basic, House Rent, Conveyance, Medical.
   *
   * Frozen when the figure was set, not worked out when it is read: the rule
   * lives in Settings and can change, and a raise recorded in March should go
   * on showing the split it was given. Null on rows written before the split
   * existed, which the screen shows as a gross and nothing else.
   */
  components: PayslipLineDto[] | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string | null;
  createdAt: string;
};

/** One person the month could pay, as the run pickers list them. */
export type EligibleMemberDto = {
  id: string;
  fullName: string;
  designation: string | null;
  department: string | null;
  status: string;
  /** Their pay as of the month's end — null when none is recorded. */
  monthlyGross: string | null;
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
  /* How many documents of each kind hang on the run. The table draws an eye
     only where its own drawer has something in it. */
  invoiceCount: number;
  recordCount: number;
};

export type PayrollLineDto = {
  id: string;
  teamMemberId: string;
  fullName: string;
  engagementType: EngagementType;
  grossAmount: string;
  bonusAmount: string;
  otherAdditions: string;
  tdsAmount: string;
  /**
   * Whether that figure was typed rather than worked out.
   *
   * The sheet needs it to say which of the two a cell holds — the tax is
   * auto-calculated and hand-editable at once, and a screen that cannot tell
   * them apart is the reason the field was read-only in the first place.
   */
  tdsManual: boolean;
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
  /**
   * How the gross and the deductions were made up, frozen when the run was
   * built. `null` on lines created before the breakdown existed, which the
   * payslip renders as a single Basic Salary row rather than an empty table.
   */
  /**
   * Everything the tax figure was worked out from, frozen when it was.
   *
   * The whole rule rather than a reference to it: policy rows are edited in
   * place, so a reference would mean next year's rates rewrote the working
   * behind every payslip already issued. Null on lines from before the app
   * calculated, and where no rule is set up for the year.
   */
  tdsBasis: TdsBasis | null;
  tdsDeclaredInvestment: string | null;
  earningsBreakdown: PayslipLineDto[] | null;
  deductionsBreakdown: PayslipLineDto[] | null;
  paidDays: number | null;
  workingDays: number | null;
  remarks: string | null;
  /**
   * Taka per dollar for this line, typed on the sheet.
   *
   * Null means nobody has stated one — the dollar column shows nothing rather
   * than converting at whatever the rate happens to be today.
   */
  fxRate: string | null;
};

/** One social account on a person's profile. */
export type TeamSocialDto = {
  id: string;
  platform: SocialPlatform;
  handle: string;
  sortOrder: number;
};

/** One year's income-tax e-Return on a person's profile. */
export type EreturnDto = {
  id: string;
  fiscalYear: number;
  submittedOn: string | null;
  notes: string | null;
  fileId: string | null;
  fileName: string | null;
};

/** A labelled amount on the payslip's earnings or deductions side. */
export type PayslipLineDto = { label: string; amount: string };

export type PayslipDto = PayrollLineDto & {
  runId: string;
  runLabel: string;
  runStatus: PayrollStatus;
  periodYear: number;
  periodMonth: number;
  paymentDate: string | null;
  paymentMethod: string;
  /** Live from the person, not frozen — a staff code does not change monthly. */
  employeeCode: string | null;
  joinedOn: string;
  engagementType: EngagementType;
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
  list: (
    params: {
      page?: number;
      q?: string;
      status?: string;
      engagementType?: string;
    } = {},
  ) => {
    const search = new URLSearchParams({
      page: String(params.page ?? 1),
      // Was 100, which is not a page size — it is where the list stopped, and
      // person 101 could not be reached from anywhere in the app.
      pageSize: String(PAGE_SIZE),
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
    apiFetch<TeamMemberDto>("/team-members", {
      method: "POST",
      ...json(input),
    }),
  update: (id: string, input: UpdateTeamMemberInput) =>
    apiFetch<TeamMemberDto>(`/team-members/${id}`, {
      method: "PATCH",
      ...json(input),
    }),

  /** Separately gated — HR gets a 403 here. */
  ereturns: (id: string) =>
    apiFetch<EreturnDto[]>(`/team-members/${id}/ereturns`, {
      cache: "no-store",
    }),
  upsertEreturn: (id: string, input: UpsertEreturnInput) =>
    apiFetch<EreturnDto>(`/team-members/${id}/ereturns`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  socials: (id: string) =>
    apiFetch<TeamSocialDto[]>(`/team-members/${id}/socials`, {
      cache: "no-store",
    }),
  setSocials: (id: string, input: SetTeamSocialsInput) =>
    apiFetch<{ socials: TeamSocialDto[] }>(`/team-members/${id}/socials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  compensation: (id: string) =>
    apiFetch<CompensationDto[]>(`/team-members/${id}/compensation`, {
      cache: "no-store",
    }),
  setCompensation: (id: string, input: SetCompensationInput) =>
    apiFetch<CompensationDto>(`/team-members/${id}/compensation`, {
      method: "POST",
      ...json(input),
    }),

  /**
   * Give everyone with no pay on record the figure they were hired at,
   * effective from their own joining date.
   *
   * Only touches people who have no pay record at all, so it can never
   * overwrite a raise, and every row it writes is in the audit log with the
   * amount.
   */
  /**
   * What everybody earns now, keyed by person.
   *
   * Fetched separately from the directory on purpose: the team DTO cannot
   * carry a pay figure, which is what keeps the boundary structural. Only
   * called when the session holds `team.compensation.read`.
   */
  currentSalaries: () =>
    apiFetch<
      Array<{ teamMemberId: string; grossAmount: string; currency: string }>
    >("/team-members/compensation/current", { cache: "no-store" }),

  setPayFromJoiningSalary: () =>
    apiFetch<{ created: number; names: string[]; skipped: string[] }>(
      "/team-members/compensation/from-joining-salary",
      { method: "POST" },
    ),
};

export const payrollApi = {
  listRuns: (page = 1) =>
    apiFetch<Paginated<PayrollRunDto>>(
      `/payroll/runs?page=${page}&pageSize=${PAGE_SIZE}`,
      { cache: "no-store" },
    ),
  getRun: (id: string) =>
    apiFetch<{ run: PayrollRunDto; lines: PayrollLineDto[] }>(
      `/payroll/runs/${id}`,
      { cache: "no-store" },
    ),
  createRun: (input: CreatePayrollRunInput) =>
    apiFetch<PayrollRunDto>("/payroll/runs", {
      method: "POST",
      ...json(input),
    }),
  /** Who could be on a month's sheet, with what they would be paid. */
  eligible: (periodYear: number, periodMonth: number) =>
    apiFetch<EligibleMemberDto[]>(
      `/payroll/eligible?periodYear=${periodYear}&periodMonth=${periodMonth}`,
      { cache: "no-store" },
    ),
  /**
   * Makes a draft run hold exactly these people. Kept lines are untouched,
   * edits and all — the promise generateLines cannot make.
   */
  syncMembers: (id: string, teamMemberIds: string[]) =>
    apiFetch<{
      added: number;
      removed: number;
      skipped: string[];
      message?: string;
    }>(`/payroll/runs/${id}/members`, {
      method: "POST",
      ...json({ teamMemberIds }),
    }),
  generateLines: (id: string) =>
    apiFetch<{ created: number; skipped: string[]; message?: string }>(
      `/payroll/runs/${id}/generate-lines`,
      { method: "POST" },
    ),
  recalculateTds: (id: string) =>
    apiFetch<{ changed: number; message: string }>(
      `/payroll/runs/${id}/recalculate-tds`,
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
    apiFetch<MemberPayslipDto[]>(`/payroll/members/${teamMemberId}/payslips`, {
      cache: "no-store",
    }),
};
