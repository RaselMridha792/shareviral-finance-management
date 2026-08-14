import { z } from "zod";
import { patchOf } from "./patch.ts";

import {
  amountSchema,
  assessmentYearSchema,
  etinSchema,
  isoDateSchema,
  psrStatusSchema,
} from "./masters.ts";
import { paginationQuerySchema } from "./pagination.ts";
import { paymentMethodSchema } from "./transactions.ts";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const optionalOf = <T extends z.ZodType<string>>(schema: T) =>
  z
    .union([schema, z.literal("")])
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/**
 * A link, not an upload.
 *
 * This app stores no files anywhere — a receipt is a Drive link, and so are a
 * photo, a CV and an appointment letter. One definition so every one of them
 * accepts exactly the same thing: `https://` and nothing else. `http://` is
 * refused rather than upgraded, because a link that silently downgrades is a
 * link somebody pastes a password into.
 */
const optionalLink = () =>
  optionalOf(
    z
      .string()
      .trim()
      .max(500)
      .refine((v) => /^https:\/\/\S+$/.test(v), "Paste an https:// link"),
  );

/* -------------------------------------------------------------------------- */
/*  Team members                                                               */
/* -------------------------------------------------------------------------- */

export const ENGAGEMENT_TYPES = ["employee", "contractor"] as const;
export const engagementTypeSchema = z.enum(ENGAGEMENT_TYPES);
export type EngagementType = z.infer<typeof engagementTypeSchema>;

export const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  employee: "Employee",
  contractor: "Contractor",
};

export const EMPLOYMENT_STATUSES = [
  "active",
  "on_leave",
  "resigned",
  "terminated",
] as const;
export const employmentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = z.infer<typeof employmentStatusSchema>;

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: "Working",
  on_leave: "On leave",
  resigned: "Resigned",
  terminated: "Let go",
};

/**
 * The fields the company's own employee sheet carries, and no more.
 *
 * The sheet is the specification: name, designation, age, gender, blood group,
 * both addresses, date of birth, NID, contact number, email, CV, joining date,
 * signed appointment letter, joining salary, education level and major, photo,
 * notes. Fields this app adds on top of that are the ones other features need —
 * bank and wallet details for payroll, e-TIN and PSR for withholding, and the
 * code / engagement / status trio the app is built around.
 *
 * Everything below is optional. A person is added with a name, a code and a
 * joining date; the rest is filled in as it becomes known, and a required
 * field nobody has to hand is a required field people invent an answer for.
 */
export const GENDERS = ["female", "male", "other", "undisclosed"] as const;
export const genderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof genderSchema>;

export const GENDER_LABELS: Record<Gender, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  undisclosed: "Not stated",
};

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;
export const bloodGroupSchema = z.enum(BLOOD_GROUPS);
export type BloodGroup = z.infer<typeof bloodGroupSchema>;

/**
 * How far somebody got in school.
 *
 * The list is longer than the two answers currently on record, on purpose: an
 * HR list that only offers what today's staff happen to hold is a list that
 * gets bypassed the first time somebody joins with a diploma. `other` is the
 * escape hatch, and the major beside it carries the detail.
 */
export const EDUCATION_LEVELS = [
  "ssc",
  "hsc",
  "diploma",
  "bachelors",
  "masters",
  "phd",
  "other",
] as const;
export const educationLevelSchema = z.enum(EDUCATION_LEVELS);
export type EducationLevel = z.infer<typeof educationLevelSchema>;

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  ssc: "SSC",
  hsc: "HSC",
  diploma: "Diploma",
  bachelors: "Bachelor's",
  masters: "Master's",
  phd: "PhD",
  other: "Other",
};

/**
 * Strict on purpose.
 *
 * A field that is no longer collected — the ones this app once asked for and
 * the sheet never did: marital status, parents' names, religion, passport,
 * emergency contact, reporting manager, probation and confirmation dates — is
 * not silently ignored here, it is rejected. `strictObject` is what makes
 * "we removed that" true rather than a claim about the form.
 */
/**
 * No employee code.
 *
 * There was one, required and unique, and the company does not have such a
 * thing: the staff sheet has nineteen columns and none of them is a code. So
 * every import and every new joiner needed a code invented on the spot —
 * SV-001, SV-002 — which is a made-up identifier that then looks official on a
 * payslip and in an export, and which nobody could reconcile against anything.
 *
 * A required field nobody has an answer for is a field people invent an answer
 * for. People are identified here by name, and by the row itself.
 */
export const createTeamMemberSchema = z.strictObject({
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  engagementType: engagementTypeSchema.default("employee"),
  department: optionalText(60),
  designation: optionalText(80),
  joinedOn: isoDateSchema,
  /**
   * The sheet has one Email column, and what it holds is personal addresses —
   * so an import maps it here. `workEmail` stays for the company address,
   * which some people have and the sheet has never recorded; whoever imports
   * decides per row if a value is one or the other.
   */
  personalEmail: optionalOf(z.string().trim().email("Enter a valid email")),
  workEmail: optionalOf(z.string().trim().email("Enter a valid email")),
  phone: optionalText(30),
  nid: optionalText(20),
  etin: optionalOf(etinSchema),
  psrStatus: psrStatusSchema.default("unknown"),
  psrAssessmentYear: optionalOf(assessmentYearSchema),
  bankName: optionalText(80),
  bankAccountNumber: optionalText(40),
  bankRouting: optionalText(20),
  walletProvider: optionalText(30),
  walletNumber: optionalText(20),
  address: optionalText(300),
  notes: optionalText(500),

  /* --- who they are ---------------------------------------------------- */

  /**
   * A link, not a file. This app stores no blobs — receipts are Drive links
   * and so is this, which keeps backups a database dump and nothing else.
   *
   * The sheet calls this "Decent Image of the Employee".
   */
  photoUrl: optionalLink(),
  /** The sheet's Age column is derived from this rather than typed in. */
  dateOfBirth: optionalOf(isoDateSchema),
  gender: genderSchema.optional(),
  bloodGroup: bloodGroupSchema.optional(),

  /* --- where they are --------------------------------------------------- */

  /** `address` above is the present one; this is the permanent one. */
  permanentAddress: optionalText(300),

  /* --- the shape of the job -------------------------------------------- */

  /**
   * The salary agreed at hire — and the one deliberate exception to the rule
   * that HR sees no pay.
   *
   * Read the exception narrowly. This is a fact about the offer that was made,
   * frozen on the day they joined; it is HR's own paperwork and it never
   * changes again. What anybody is paid *now* — every raise, the current
   * figure, the history — stays in `compensation_history`, behind
   * `team.compensation.read`, which HR does not hold. A field here can never
   * reach that table: this schema drives `team_members` and nothing joins the
   * two.
   *
   * So the boundary is not gone, it moved: HR sees one number from the offer
   * letter, and nothing about payroll.
   */
  joiningSalary: optionalOf(amountSchema),

  educationLevel: educationLevelSchema.optional(),
  /**
   * Free text, deliberately. The real answers run from CSE and HRM to Wet
   * Process Engineering — a list somebody has to maintain is a list that is
   * missing the next person's subject on the day they join.
   */
  educationMajor: optionalText(120),

  /* --- papers on file --------------------------------------------------- */

  /** Links, like the photo. Nothing is uploaded to this app. */
  cvUrl: optionalLink(),
  appointmentLetterUrl: optionalLink(),
});
export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = patchOf(createTeamMemberSchema)
  .extend({
    status: employmentStatusSchema.optional(),
    /**
     * Nullable, unlike every other optional field here.
     *
     * In a PATCH `undefined` means "leave it alone", so with only that there
     * is no way to say "they came back — they have no last day any more". A
     * person moved from Resigned to Working would keep the leaving date they
     * were given, and the record would read as someone who left and is still
     * employed. `null` clears it; `""` is treated the same way, because that
     * is what an emptied date input sends.
     */
    endedOn: z
      .union([isoDateSchema, z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>;

export const listTeamQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  engagementType: engagementTypeSchema.optional(),
  status: employmentStatusSchema.optional(),
  department: z.string().trim().max(60).optional(),
});
export type ListTeamQuery = z.infer<typeof listTeamQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Compensation                                                               */
/* -------------------------------------------------------------------------- */

export const setCompensationSchema = z.strictObject({
  grossAmount: amountSchema,
  effectiveFrom: isoDateSchema,
  changeReason: optionalText(200),
});
export type SetCompensationInput = z.infer<typeof setCompensationSchema>;

/* -------------------------------------------------------------------------- */
/*  Payroll                                                                    */
/* -------------------------------------------------------------------------- */

export const PAYROLL_STATUSES = [
  "draft",
  "finalized",
  "partially_paid",
  "paid",
] as const;
export const payrollStatusSchema = z.enum(PAYROLL_STATUSES);
export type PayrollStatus = z.infer<typeof payrollStatusSchema>;

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: "Draft",
  finalized: "Finalised",
  partially_paid: "Partly paid",
  paid: "Paid",
};

/**
 * The run statuses a payslip exists for.
 *
 * A draft is a working sheet — the tax figure is still being typed in and the
 * net changes with it, so a slip issued from one would be a document that
 * contradicts itself tomorrow. Finalising is what freezes the figures, and
 * everything from that point on is a real payslip whether the money has left
 * the account yet or not.
 *
 * Listed rather than written as "not draft" so a status added later has to be
 * placed on one side of the line deliberately.
 */
export const PAYSLIP_RUN_STATUSES = [
  "finalized",
  "partially_paid",
  "paid",
] as const satisfies readonly PayrollStatus[];

export const PAYMENT_MODES = ["consolidated", "individual"] as const;
export const paymentModeSchema = z.enum(PAYMENT_MODES);
export type PaymentMode = z.infer<typeof paymentModeSchema>;

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  consolidated: "One entry for the whole run",
  individual: "One entry per person",
};

export const createPayrollRunSchema = z.strictObject({
  periodYear: z.coerce.number().int().min(2000).max(2200),
  periodMonth: z.coerce.number().int().min(1).max(12),
  notes: optionalText(500),
});
export type CreatePayrollRunInput = z.infer<typeof createPayrollRunSchema>;

export const updatePayrollLineSchema = z
  .strictObject({
    grossAmount: amountSchema.optional(),
    bonusAmount: amountSchema.optional(),
    otherAdditions: amountSchema.optional(),
    tdsAmount: amountSchema.optional(),
    otherDeductions: amountSchema.optional(),
    deductionNote: optionalText(200),
    remarks: optionalText(200),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdatePayrollLineInput = z.infer<typeof updatePayrollLineSchema>;

export const payPayrollSchema = z.strictObject({
  paymentDate: isoDateSchema,
  accountId: z.string().uuid("Choose the account paying"),
  paymentMode: paymentModeSchema.default("consolidated"),
  paymentMethod: paymentMethodSchema.default("bank_transfer"),
});
export type PayPayrollInput = z.infer<typeof payPayrollSchema>;

export const listPayrollRunsQuerySchema = paginationQuerySchema.extend({
  status: payrollStatusSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});
export type ListPayrollRunsQuery = z.infer<typeof listPayrollRunsQuerySchema>;

/**
 * A TDS figure far above the gross is almost always a typo — 250000 where
 * 25000 was meant. The app does not calculate tax, but it can notice that.
 */
export const TDS_WARNING_RATIO = 0.3;
