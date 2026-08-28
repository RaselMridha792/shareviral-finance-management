import { z } from "zod";
import { patchOf } from "./patch.ts";
import { isNAText } from "./transactions.ts";

import {
  amountSchema,
  DEFAULT_SALARY_SPLIT,
  assessmentYearSchema,
  etinSchema,
  isoDateSchema,
  psrStatusSchema,
  type SalarySplit,
} from "./masters.ts";
import { fromMinorUnits, toMinorUnits } from "./money.ts";
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
// A typed "N/A" counts as leaving the box empty — see isNAText's note.
const optionalLink = () =>
  z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" || isNAText(v) ? undefined : v))
    .optional()
    .refine((v) => v === undefined || /^https:\/\/\S+$/.test(v), {
      message: "Paste an https:// link",
    });

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

/**
 * Where and on what footing somebody works.
 *
 * A different question from `engagementType` above, and deliberately a
 * separate field. `engagementType` is what payroll runs on — employee means
 * the salary sheet draws them, contractor means they bill — and it must not
 * change meaning because HR marked somebody Remote.
 *
 * `contractual` sits in this list beside the three places of work rather than
 * duplicating `contractor`, because that is how the company describes it: the
 * question is one question, and "how are they engaged" is one of the answers
 * people give to it.
 *
 * Optional everywhere. Nobody has been asked yet, and a required field with no
 * answer is a field somebody invents an answer for.
 */
export const EMPLOYMENT_TYPES = [
  "onsite",
  "remote",
  "hybrid",
  "contractual",
] as const;
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  onsite: "Onsite",
  remote: "Remote",
  hybrid: "Hybrid",
  contractual: "Contractual",
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
  /**
   * No default. Every other enum here either has an obvious starting answer
   * (`employee`, `unknown`) or is left out; this one has none, and guessing
   * `onsite` on behalf of whoever fills the form in is how a directory ends up
   * full of a value nobody chose.
   */
  employmentType: employmentTypeSchema.optional(),
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

  /**
   * What they are paid now — offered when adding them, and editable from the
   * same drawer afterwards, on the owner's instruction that editing be
   * flexible rather than a one-shot.
   *
   * Read the comment above before widening this further: the boundary it
   * defends is intact. This field never touches `team_members` — the API
   * strips it, refuses it outright from a role without
   * `team.compensation.write`, and writes `compensation_history` through the
   * same audited path a raise takes. On create it is effective from the
   * joining date; on edit it lands as a raise effective today, and a figure
   * equal to the current one is quietly skipped rather than written twice.
   */
  currentSalary: optionalOf(amountSchema),

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
/*  What a payslip breaks down into                                           */
/* -------------------------------------------------------------------------- */

/**
 * One line on a payslip: a label and an amount.
 *
 * A list rather than fixed columns, because the company's own slip shows
 * Basic, House Rent, Medical, Conveyance and Internet today and will show
 * something else the first time somebody is given a location allowance.
 * Columns would mean a migration for each; a labelled list means typing a new
 * label.
 *
 * Frozen onto the payroll line when the run is built, not read from the
 * person's current salary. A payslip is what was paid in August, and reading
 * it back in December must not show December's structure.
 */
export const payslipLineSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  amount: amountSchema,
});
export type PayslipLine = z.infer<typeof payslipLineSchema>;

export const payslipBreakdownSchema = z.array(payslipLineSchema).max(20);
export type PayslipBreakdown = z.infer<typeof payslipBreakdownSchema>;

/**
 * The headings the company's own payslip uses, offered as a starting point.
 *
 * Not an enum — see above. These are what the "add the usual lines" button
 * fills in, and every one of them can be renamed or removed.
 */
export const USUAL_EARNINGS = [
  "Basic Salary",
  "House Rent Allowance",
  "Medical Allowance",
  "Conveyance Allowance",
  "Internet / Mobile Allowance",
] as const;

export const USUAL_DEDUCTIONS = [
  "Salary Advance",
  "Leave Without Pay",
] as const;

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

/** Who could be on a month's sheet — asked before the run exists. */
export const payrollEligibleQuerySchema = z.strictObject({
  periodYear: z.coerce.number().int().min(2000).max(2200),
  periodMonth: z.coerce.number().int().min(1).max(12),
});
export type PayrollEligibleQuery = z.infer<typeof payrollEligibleQuerySchema>;

/**
 * The people a draft run should hold — the whole list, not a delta.
 *
 * Declarative on purpose: the screen shows a checklist, and a checklist's
 * truth is its final state. The server works out who to add and who to drop,
 * and — the part a wipe-and-rebuild cannot promise — leaves the lines of
 * everyone who stays exactly as they are, edits and all.
 */
export const syncRunMembersSchema = z.strictObject({
  teamMemberIds: z.array(z.string().uuid()).max(500),
});
export type SyncRunMembersInput = z.infer<typeof syncRunMembersSchema>;

export const updatePayrollLineSchema = z
  .strictObject({
    grossAmount: amountSchema.optional(),
    bonusAmount: amountSchema.optional(),
    otherAdditions: amountSchema.optional(),
    // No `tdsAmount`. The app works the tax out from the year's rule; a screen
    // that let somebody type over it would make the stored working a lie.
    // Settings → Salary TDS is where a wrong figure gets fixed.
    tdsDeclaredInvestment: amountSchema.nullable().optional(),
    otherDeductions: amountSchema.optional(),
    deductionNote: optionalText(200),
    remarks: optionalText(200),

    // The payslip's middle. `null` clears a breakdown back to "just the gross",
    // which is distinct from omitting the key and leaving what is there.
    earningsBreakdown: payslipBreakdownSchema.nullable().optional(),
    deductionsBreakdown: payslipBreakdownSchema.nullable().optional(),

    // "24 of 26". Both or neither — a paid-days figure with nothing to be out
    // of prints as a number nobody can read.
    paidDays: z.number().int().min(0).max(31).nullable().optional(),
    workingDays: z.number().int().min(1).max(31).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" })
  .refine(
    (v) =>
      v.paidDays == null ||
      v.workingDays == null ||
      v.paidDays <= v.workingDays,
    {
      message: "Paid days cannot be more than the working days",
      path: ["paidDays"],
    },
  );
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

/* -------------------------------------------------------------------------- */
/*  How a gross salary is split                                                */
/* -------------------------------------------------------------------------- */

/**
 * The company's own convention, on a handwritten sheet: a one lakh salary is
 * Basic 60,000, House Rent 30,000, Conveyance 6,000, Medical 4,000.
 *
 * Percentages rather than amounts, because that is what makes it a rule and not
 * one person's figures — and a list rather than four fields, because the next
 * allowance somebody invents should cost a label, exactly as it does on the
 * payslip's own breakdown.
 *
 * A default, not a law. It lives in Settings for the same reason the tax bands
 * do: the owner asked for the rule to be somewhere they could change it rather
 * than buried in code.
 */

/**
 * A gross, divided.
 *
 * Exact in paisa, and the rounding is not left to land wherever the arithmetic
 * drops it: every part is floored, and whatever pennies are over go to the
 * FIRST part. That keeps the total equal to the gross — a split that adds to
 * one paisa less than the salary is the kind of thing an auditor finds and
 * nobody can explain — and it puts the odd paisa on Basic, which is both the
 * largest line and the one a payslip reader expects to carry it.
 */
export function splitSalary(
  grossAmount: string,
  split: SalarySplit = DEFAULT_SALARY_SPLIT,
): PayslipBreakdown {
  if (split.length === 0) return [];

  const gross = toMinorUnits(grossAmount);
  // Percent to four places as an integer, so 33.33% is exact and no float
  // multiplication touches the money itself.
  const parts = split.map((part) => ({
    label: part.label,
    minor: (gross * BigInt(Math.round(part.percent * 100))) / 10000n,
  }));

  const allocated = parts.reduce((sum, part) => sum + part.minor, 0n);
  parts[0].minor += gross - allocated;

  return parts.map((part) => ({
    label: part.label,
    amount: fromMinorUnits(part.minor),
  }));
}
