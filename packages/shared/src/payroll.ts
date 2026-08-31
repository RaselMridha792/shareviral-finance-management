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
 * The employee ID — back, and optional this time.
 *
 * It was here once as a REQUIRED, unique code, and that was the mistake: the
 * company's staff sheet has nineteen columns and none of them is a code, so
 * every import and every new joiner needed one invented on the spot — SV-001,
 * SV-002 — a made-up identifier that then looked official on a payslip. A
 * required field nobody has an answer for is a field people invent an answer
 * for, so it was removed.
 *
 * The owner has now asked for the column, and the difference is the whole
 * point: **optional**. Somebody who has an ID gets it recorded and printed;
 * the eighteen people already on the books keep no ID at all and nothing
 * demands one. The database column and its unique index have been there since
 * 2026-08-19 and the payslip already prints it — this only gives it a way in
 * and a way to be read.
 *
 * Unique per company still holds, enforced by the index rather than here, and
 * a clash comes back naming the person who has it rather than as a 500.
 */
export const createTeamMemberSchema = z.strictObject({
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  /**
   * Blank clears it, rather than meaning "leave what is there".
   *
   * `optionalText` maps "" to undefined, and on a PATCH undefined means "do
   * not touch" — so an emptied box would silently keep the old ID. `endedOn`
   * solved this first; the same union is used here.
   */
  employeeCode: z
    .union([z.string().trim().min(1).max(40), z.literal(""), z.null()])
    .transform((v) => (v === "" ? null : v))
    .optional(),
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
  /* The name on the account. A bank rejects a transfer that does not match. */
  bankAccountHolder: optionalText(120),
  bankAccountNumber: optionalText(40),
  bankBranch: optionalText(80),
  bankRouting: optionalText(20),
  /*
   * Checked rather than merely stored. `optionalText` here takes a length, not
   * a schema — the payroll module's helper differs from the masters one — so
   * the shape is written out. A wrong SWIFT is not a cosmetic error: it is a
   * salary that does not arrive, found out days later by the person waiting
   * for it.
   */
  bankSwift: z
    .union([
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(
          /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
          "A SWIFT code is 8 or 11 characters, like SCBLBDDX",
        ),
      z.literal(""),
      z.null(),
    ])
    .transform((v) => (v === "" ? null : v))
    .optional(),
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

    /*
     * Days actually worked this month, out of the month's own calendar length
     * — 28, 29, 30 or 31, the API knows which. Setting it re-figures the
     * gross pro-rata, scales every earnings line with it, and the tax is
     * worked out on the pro-rated figure, not the full month's salary. Null
     * puts the full month back. The old paidDays column still exists in the
     * database and is no longer written — one number is the owner's rule,
     * and two numbers was how a slip printed "14 of 14" that meant nothing.
     */
    workingDays: z.number().int().min(1).max(31).nullable().optional(),

    /*
     * Taka per dollar for this one line. Null clears it, which is different
     * from omitting the key and leaving what is there.
     *
     * Not `amountSchema`: that is money at two decimal places, and a rate is a
     * divisor. At two places 122.00 and 122.004 move a 12,00,000 net by more
     * than thirty dollars, so it takes six — the same precision `fx_rates` and
     * `transactions.fx_rate` are stored at.
     */
    fxRate: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,6})?$/, "Enter a rate like 122.50")
      .refine((v) => Number(v) > 0, "A rate has to be more than nothing")
      .nullable()
      .optional(),
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

/* -------------------------------------------------------------------------- */
/*  A person's social accounts                                                */
/* -------------------------------------------------------------------------- */

/**
 * The platforms a team member's account can be on.
 *
 * Written down once, here, because the web draws the chips from it and the API
 * validates against it. Plain text in the database rather than a pgEnum, for
 * the reason `subscriptions.billing_cycle` is: this list will grow, and an
 * `ALTER TYPE` cannot run inside a transaction and has to reach two databases.
 *
 * `website` and `other` are the escape hatches. Somebody will have a portfolio
 * or a platform nobody thought of, and a list that forces the nearest wrong
 * choice produces a directory full of values nobody meant.
 */
export const SOCIAL_PLATFORMS = [
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "youtube",
  "github",
  "whatsapp",
  "telegram",
  "website",
  "other",
] as const;
export const socialPlatformSchema = z.enum(SOCIAL_PLATFORMS);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  youtube: "YouTube",
  github: "GitHub",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  website: "Website",
  other: "Other",
};

/**
 * Where a handle goes when it is not already a whole address.
 *
 * `null` for the platforms that have no single profile URL to build — a phone
 * number is not a path, and "other" is by definition unknown. Those show the
 * value as text rather than as a link that would go somewhere wrong.
 */
const SOCIAL_PLATFORM_BASE: Record<SocialPlatform, string | null> = {
  linkedin: "https://www.linkedin.com/in/",
  facebook: "https://www.facebook.com/",
  instagram: "https://www.instagram.com/",
  x: "https://x.com/",
  youtube: "https://www.youtube.com/@",
  github: "https://github.com/",
  whatsapp: null,
  telegram: "https://t.me/",
  website: null,
  other: null,
};

/**
 * The address a social entry opens, or null when there is nothing safe to open.
 *
 * Three cases, in order:
 *   - the value is already a URL — use it as typed, because somebody who pasted
 *     a whole address knows where it goes better than a rule does;
 *   - the platform has a base and the value is a handle — join them, dropping a
 *     leading "@" which people type out of habit and no path wants;
 *   - anything else — null, and the screen prints the value as plain text. A
 *     link that lands on the wrong profile is worse than no link.
 */
export function socialUrl(
  platform: SocialPlatform,
  handle: string,
): string | null {
  const value = handle.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (platform === "website" && /\./.test(value)) return `https://${value}`;
  const base = SOCIAL_PLATFORM_BASE[platform];
  if (!base) return null;
  return base + value.replace(/^@/, "");
}

export const teamSocialSchema = z.strictObject({
  platform: socialPlatformSchema,
  handle: z.string().trim().min(1, "Type the handle or the address").max(300),
});
export type TeamSocialInput = z.infer<typeof teamSocialSchema>;

/**
 * The whole list, not a delta — the shape `syncRunMembers` and the subscription
 * seats already use. A checklist's truth is its final state, and one request
 * means one audit row rather than three that have to be read together.
 */
export const setTeamSocialsSchema = z
  .strictObject({ socials: z.array(teamSocialSchema).max(20) })
  .refine(
    (v) => new Set(v.socials.map((s) => s.platform)).size === v.socials.length,
    { message: "That platform is already on this list", path: ["socials"] },
  );
export type SetTeamSocialsInput = z.infer<typeof setTeamSocialsSchema>;

/* -------------------------------------------------------------------------- */
/*  E-Return — one per fiscal year                                            */
/* -------------------------------------------------------------------------- */

/**
 * "2026-2027" — the fiscal year written out in full.
 *
 * `periods.ts` already has `fiscalYearOf` and `fiscalYearLabel`, and they are
 * the ones to use: mode-aware, tested, and the app's own. This adds nothing but
 * a second SPELLING, because the owner asked for the year in full — *"akhane
 * akta kore ortho bochor thakbe like 2026-2027"* — and `fiscalYearLabel` gives
 * the short form the rest of the app reads better in ("FY 2026-27").
 *
 * A first draft of this file duplicated all three helpers before noticing they
 * existed. They are one import away in `periods.ts`.
 */
export function fiscalYearLabelLong(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}

export const upsertEreturnSchema = z.strictObject({
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
  submittedOn: z
    .union([isoDateSchema, z.literal("")])
    .transform((v) => (v === "" ? null : v))
    .nullish(),
  notes: optionalText(300),
});
export type UpsertEreturnInput = z.infer<typeof upsertEreturnSchema>;
