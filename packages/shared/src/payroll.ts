import { z } from "zod";

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
 * The fields a Bangladeshi employment record actually carries.
 *
 * Parents' names are not sentiment: they appear on most statutory forms here,
 * and an HR team that has to chase them one by one at filing time will keep a
 * second spreadsheet instead — which is the thing this app exists to end.
 * Blood group is for the day somebody needs it in a hurry.
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

export const MARITAL_STATUSES = [
  "single",
  "married",
  "divorced",
  "widowed",
  "undisclosed",
] as const;
export const maritalStatusSchema = z.enum(MARITAL_STATUSES);
export type MaritalStatus = z.infer<typeof maritalStatusSchema>;

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
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

export const createTeamMemberSchema = z.strictObject({
  employeeCode: z.string().trim().min(1, "Give them a code").max(20),
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  engagementType: engagementTypeSchema.default("employee"),
  department: optionalText(60),
  designation: optionalText(80),
  joinedOn: isoDateSchema,
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
   */
  photoUrl: optionalOf(
    z
      .string()
      .trim()
      .max(500)
      .refine((v) => /^https:\/\/\S+$/.test(v), "Paste an https:// link"),
  ),
  dateOfBirth: optionalOf(isoDateSchema),
  gender: genderSchema.optional(),
  maritalStatus: maritalStatusSchema.optional(),
  spouseName: optionalText(120),
  fatherName: optionalText(120),
  motherName: optionalText(120),
  bloodGroup: bloodGroupSchema.optional(),
  religion: optionalText(40),
  passportNumber: optionalText(20),

  /* --- where they are and who to call ---------------------------------- */

  /** `address` above is the present one; this is the permanent one. */
  permanentAddress: optionalText(300),
  emergencyContactName: optionalText(120),
  emergencyContactRelation: optionalText(40),
  emergencyContactPhone: optionalText(30),

  /* --- the shape of the job -------------------------------------------- */

  reportingManagerId: z.string().uuid().nullish(),
  probationUntil: optionalOf(isoDateSchema),
  confirmedOn: optionalOf(isoDateSchema),
  lastQualification: optionalText(120),
});
export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>;

export const updateTeamMemberSchema = createTeamMemberSchema
  .partial()
  .extend({
    status: employmentStatusSchema.optional(),
    endedOn: optionalOf(isoDateSchema),
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
