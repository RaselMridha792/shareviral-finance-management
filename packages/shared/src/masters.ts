import { z } from "zod";
import { boolish, patchOf } from "./patch.ts";

import { paginationQuerySchema } from "./pagination.ts";

/**
 * Contracts for the master data: accounts, categories, vendors, settings.
 *
 * The API validates with these, the web forms validate with these, and the AI
 * intake generates its JSON Schema from these. One definition, so a field
 * cannot become required on one side and optional on the other.
 */

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/** A positive money string Postgres will accept as numeric(14,2). */
/**
 * A money figure: digits, at most two decimals, never negative.
 *
 * The minus used to be allowed here — `/^-?\d…/` — and only
 * `createTransactionSchema` refused it, with its own `.refine(> 0)` on top.
 * Everywhere else a negative passed validation and reached Postgres, which
 * refused it with a check-constraint violation that escaped as a **500**:
 * `POST /tds/deposits {"amount":"-1.00"}` and a negative gross on a
 * compensation record both did exactly that, and the server logged the whole
 * failing statement with its parameter values. An account would open at
 * -5.00 with no complaint at all.
 *
 * Direction is what makes money negative in this app — `signed_amount` is
 * generated from it. A magnitude that carries its own sign is a second, silent
 * way to say the same thing, and the two disagree the moment somebody types a
 * minus into a box labelled "amount".
 */
export const amountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 4500 or 4500.50");

/**
 * A calendar date that actually exists.
 *
 * The shape check alone accepted `2026-13-45`, which then reached Postgres and
 * came back as a **500**. Checked against the calendar here so it is a field
 * error on the form instead — and compared as strings, never through a local
 * `Date`, which in Dhaka would shift the day.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    if (month < 1 || month > 12 || day < 1) return false;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= daysInMonth;
  }, "That date does not exist");

/** Bangladesh e-TIN: exactly 12 digits. */
export const etinSchema = z
  .string()
  .trim()
  .regex(/^\d{12}$/, "An e-TIN is 12 digits");

/** VAT Business Identification Number: exactly 13 digits. */
export const binSchema = z
  .string()
  .trim()
  .regex(/^\d{13}$/, "A BIN is 13 digits");

/** "2026-2027". */
export const assessmentYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, "Use the form 2026-2027");

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour");

/**
 * Blank inputs arrive as "" from HTML forms; treat them as absent.
 *
 * `.optional()` goes last on purpose. Applied before `.transform()`, Zod infers
 * the key as required-but-possibly-undefined, which forces every caller to pass
 * every field even on a partial update.
 */
const optionalText = (schema: z.ZodType<string>) =>
  z
    .union([schema, z.literal("")])
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/* -------------------------------------------------------------------------- */
/*  Accounts                                                                   */
/* -------------------------------------------------------------------------- */

export const ACCOUNT_TYPES = ["bank", "cash", "mobile_wallet", "card"] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank account",
  cash: "Cash",
  mobile_wallet: "Mobile wallet",
  /** A prepaid card, usually held in dollars and used for tooling. */
  card: "Card",
};

export const createAccountSchema = z.strictObject({
  name: z.string().trim().min(2, "Give the account a name").max(80),
  type: accountTypeSchema,
  bankName: optionalText(z.string().trim().max(80)),
  branch: optionalText(z.string().trim().max(80)),
  accountNumber: optionalText(z.string().trim().max(40)),
  routingNumber: optionalText(z.string().trim().max(20)),
  /**
   * The bank's SWIFT/BIC. Eight or eleven characters — the shorter form is the
   * head office, the longer one names a branch.
   */
  swiftCode: optionalText(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
        "A SWIFT code is 8 or 11 characters, like SCBLBDDX",
      ),
  ),
  currency: z.string().trim().length(3).default("BDT"),
  openingBalance: amountSchema.default("0"),
  openingBalanceOn: isoDateSchema,
  notes: optionalText(z.string().trim().max(500)),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = patchOf(createAccountSchema)
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const listAccountsQuerySchema = z.strictObject({
  includeInactive: boolish.default(false),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Categories                                                                 */
/* -------------------------------------------------------------------------- */

export const CATEGORY_KINDS = ["in", "out", "both"] as const;
export const categoryKindSchema = z.enum(CATEGORY_KINDS);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  in: "Money in",
  out: "Money out",
  both: "Both",
};

export const createCategorySchema = z.strictObject({
  name: z.string().trim().min(2, "Give the category a name").max(60),
  kind: categoryKindSchema.default("out"),
  parentId: z.string().uuid().nullish(),
  color: hexColorSchema.default("#4f46e5"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(60).optional(),
    color: hexColorSchema.optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  // Kind and parent are deliberately not editable: moving a category between
  // in/out or under a different parent would silently reclassify every
  // transaction already filed under it.
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesQuerySchema = z.strictObject({
  kind: categoryKindSchema.optional(),
  includeInactive: boolish.default(false),
});
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Vendors                                                                    */
/* -------------------------------------------------------------------------- */

export const VENDOR_TYPES = [
  "ai_tool",
  "subscription",
  "hosting",
  "supplier",
  "contractor",
  "landlord",
  "utility",
  "government",
  "other",
] as const;
export const vendorTypeSchema = z.enum(VENDOR_TYPES);
export type VendorType = z.infer<typeof vendorTypeSchema>;

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  ai_tool: "AI tool",
  subscription: "Subscription",
  hosting: "Hosting",
  supplier: "Supplier",
  contractor: "Contractor",
  landlord: "Landlord",
  utility: "Utility",
  government: "Government",
  other: "Other",
};

/**
 * The ones bought over and over: AI tools, SaaS, hosting.
 *
 * Not a separate table — an AI tool is something the company pays, which is
 * what this list has always been.
 *
 * They are deliberately **not** on an auto-renewing schedule. Some months
 * these get bought and some months they do not, so the app records what was
 * actually paid rather than projecting what is due. A screen that promises a
 * renewal that never happens is worse than one that says nothing.
 */
export const RECURRING_VENDOR_TYPES: readonly VendorType[] = [
  "ai_tool",
  "subscription",
  "hosting",
];

export function isRecurringType(type: VendorType): boolean {
  return RECURRING_VENDOR_TYPES.includes(type);
}

export const BILLING_CYCLES = [
  "none",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export const billingCycleSchema = z.enum(BILLING_CYCLES);
export type BillingCycle = z.infer<typeof billingCycleSchema>;

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  none: "Not recurring",
  monthly: "Every month",
  quarterly: "Every quarter",
  yearly: "Every year",
};

/** Months per cycle, for putting a yearly and a monthly cost on one scale. */
export const BILLING_CYCLE_MONTHS: Record<BillingCycle, number> = {
  none: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export const PSR_STATUSES = ["unknown", "submitted", "not_submitted"] as const;
export const psrStatusSchema = z.enum(PSR_STATUSES);
export type PsrStatus = z.infer<typeof psrStatusSchema>;

export const PSR_STATUS_LABELS: Record<PsrStatus, string> = {
  unknown: "Not checked",
  submitted: "Return submitted",
  not_submitted: "Not submitted",
};

export const createVendorSchema = z.strictObject({
  name: z.string().trim().min(2, "Give the vendor a name").max(120),
  type: vendorTypeSchema.default("supplier"),

  /**
   * What renews, how often, and when next.
   *
   * `billingCurrency` is its own field and not a convenience: most AI tools
   * bill in dollars while the books are in taka, and adding the two together
   * at 1:1 is a mistake this app has already made once elsewhere.
   */
  billingCycle: billingCycleSchema.default("none"),
  billingAmount: optionalText(amountSchema),
  billingCurrency: z.enum(["BDT", "USD"]).default("BDT"),
  /**
   * Kept for the rows that already carry one. Nothing reads it any more: these
   * are not on a renewal schedule, and a stored date that nothing honours is a
   * promise the screen would be making on the app's behalf.
   */
  nextRenewalOn: optionalText(isoDateSchema),
  billingAccountId: z.string().uuid().nullish(),
  etin: optionalText(etinSchema),
  bin: optionalText(binSchema),
  psrStatus: psrStatusSchema.default("unknown"),
  psrAssessmentYear: optionalText(assessmentYearSchema),
  psrReference: optionalText(z.string().trim().max(60)),
  contactName: optionalText(z.string().trim().max(80)),
  phone: optionalText(z.string().trim().max(30)),
  email: optionalText(z.string().trim().email("Enter a valid email").max(120)),
  address: optionalText(z.string().trim().max(300)),
  defaultCategoryId: z.string().uuid().nullish(),
  notes: optionalText(z.string().trim().max(500)),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = patchOf(createVendorSchema)
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const listVendorsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  type: vendorTypeSchema.optional(),
  includeInactive: boolish.default(false),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const FX_MODES = ["fixed", "live"] as const;
export const fxModeSchema = z.enum(FX_MODES);
export type FxMode = z.infer<typeof fxModeSchema>;

export const FX_REPORT_BASES = [
  "period_end",
  "period_average",
  "current",
] as const;
export const fxReportBasisSchema = z.enum(FX_REPORT_BASES);
export type FxReportBasis = z.infer<typeof fxReportBasisSchema>;

export const FX_REPORT_BASIS_LABELS: Record<FxReportBasis, string> = {
  period_end: "Rate on the last day of the period",
  period_average: "Average rate across the period",
  current: "Today's rate",
};

export const NUMBER_FORMATS = ["bangladeshi", "western"] as const;
export const numberFormatSchema = z.enum(NUMBER_FORMATS);

export const updateSettingsSchema = z
  .strictObject({
    companyName: z.string().trim().min(2).max(120).optional(),
    companyEtin: optionalText(etinSchema),
    companyBin: optionalText(binSchema),
    companyAddress: optionalText(z.string().trim().max(300)),

    fiscalYearMode: z.enum(["bd_july_june", "calendar"]).optional(),
    numberFormat: numberFormatSchema.optional(),

    fxMode: fxModeSchema.optional(),
    fxFixedUsdBdt: optionalText(
      z
        .string()
        .trim()
        .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 118.40"),
    ),
    fxProvider: optionalText(z.string().trim().max(40)),
    fxReportBasis: fxReportBasisSchema.optional(),

    tdsReminderDays: z.coerce.number().int().min(1).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export const lockBooksSchema = z.strictObject({
  /** Null reopens the books. */
  booksLockedThrough: isoDateSchema.nullable(),
});
export type LockBooksInput = z.infer<typeof lockBooksSchema>;

/* -------------------------------------------------------------------------- */

/** URL-safe slug for a category name. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
