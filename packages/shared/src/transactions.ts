import { z } from "zod";

import { amountSchema, isoDateSchema } from "./masters.ts";
import { paginationQuerySchema } from "./pagination.ts";

/**
 * The ledger contract. One definition serving the API, the web forms, the Excel
 * export, and later the AI intake's structured output.
 */

export const TXN_DIRECTIONS = ["in", "out"] as const;
export const txnDirectionSchema = z.enum(TXN_DIRECTIONS);
export type TxnDirection = z.infer<typeof txnDirectionSchema>;

export const DIRECTION_LABELS: Record<TxnDirection, string> = {
  in: "Money in",
  out: "Money out",
};

export const PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "cheque",
  "mobile_banking",
  "card",
  "other",
] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  mobile_banking: "Mobile banking",
  card: "Card",
  other: "Other",
};

export const TXN_ORIGINS = [
  "manual",
  "excel_import",
  "ai_intake",
  "payroll",
  "tax_payment",
  "system",
] as const;
export const txnOriginSchema = z.enum(TXN_ORIGINS);
export type TxnOrigin = z.infer<typeof txnOriginSchema>;

export const TXN_ORIGIN_LABELS: Record<TxnOrigin, string> = {
  manual: "Entered by hand",
  excel_import: "Imported from Excel",
  ai_intake: "Added by the assistant",
  payroll: "From a payroll run",
  tax_payment: "From a tax payment",
  system: "System",
};

/* -------------------------------------------------------------------------- */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

/** Google Drive or any https link. Checked for shape, not reachability. */
const receiptUrlSchema = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine((v) => v === undefined || /^https:\/\/\S+$/.test(v), {
    message: "Paste an https:// link",
  });

export const createTransactionSchema = z
  .strictObject({
    direction: txnDirectionSchema,
    txnDate: isoDateSchema,
    accountId: z.string().uuid("Choose an account"),
    amount: amountSchema.refine((v) => Number(v) > 0, {
      message: "The amount must be more than zero",
    }),
    categoryId: z.string().uuid("Choose a category"),

    /** Pick an existing vendor, or type a new name and it gets created. */
    vendorId: z.string().uuid().nullish(),
    vendorName: optionalText(120),
    counterparty: optionalText(160),

    paymentMethod: paymentMethodSchema.default("bank_transfer"),
    reference: optionalText(120),
    description: z.string().trim().min(2, "Say what this was for").max(300),
    notes: optionalText(1000),
    receiptUrl: receiptUrlSchema,

    /**
     * Gross bill and tax withheld, when **we** deducted tax before paying.
     *
     * Money-out only. Tax a client deducts when settling our own invoice is an
     * advance-tax credit we claim against the company's own liability — the
     * opposite direction of money, and belongs on the income tax record, not
     * here. Allowing it on a receipt would create a deposit obligation that
     * does not exist.
     */
    billAmount: amountSchema.optional(),
    withheldTaxAmount: amountSchema.optional(),

    /**
     * Where this came from, when the caller is entitled to say.
     *
     * Only the two a person can honestly claim. `payroll`, `tax_payment`,
     * `excel_import` and `system` are stamped by the code that does those
     * things — accepting them here would make "this row came from a payroll
     * run" a sentence anybody could write, and the provenance column exists
     * precisely so that it is not.
     */
    createdVia: z.enum(["manual", "ai_intake"]).optional(),

    /**
     * What a dollar was worth on the day this happened.
     *
     * Asked at entry, not applied afterwards, because this is the only moment
     * anybody knows it. A rate looked up later is the rate on the day of the
     * lookup, and a statement built from those puts a wrong dollar figure
     * beside every line with nothing on the page to say so.
     *
     * Distinct from `fxRate` below: that one is *realised* — the bank actually
     * converted at it — while this is the reference rate that lets a taka
     * figure be read in dollars. Conflating them would let a translation be
     * mistaken for a fact.
     */
    usdRate: z
      .string()
      .trim()
      .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77")
      .optional(),

    /** For a USD remittance: what was sent, and the rate the bank gave. */
    originalAmount: amountSchema.optional(),
    originalCurrency: z.string().trim().length(3).optional(),
    fxRate: z
      .string()
      .trim()
      .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 118.40")
      .optional(),
  })
  .refine(
    (v) =>
      v.withheldTaxAmount === undefined ||
      Number(v.withheldTaxAmount) === 0 ||
      v.direction === "out",
    {
      message:
        "Tax withheld belongs on a payment. If a client deducted tax from money they sent you, record that as advance tax under Income tax.",
      path: ["withheldTaxAmount"],
    },
  )
  .refine(
    (v) =>
      v.withheldTaxAmount === undefined ||
      Number(v.withheldTaxAmount) === 0 ||
      v.billAmount !== undefined,
    {
      message: "Give the gross bill amount when tax was withheld",
      path: ["billAmount"],
    },
  )
  .refine(
    (v) =>
      v.billAmount === undefined ||
      Number(v.billAmount) >=
        Number(v.amount) + Number(v.withheldTaxAmount ?? 0) - 0.005,
    {
      message: "The bill must cover the amount paid plus the tax withheld",
      path: ["billAmount"],
    },
  )
  .refine(
    (v) =>
      (v.originalAmount === undefined && v.fxRate === undefined) ||
      (v.originalAmount !== undefined && v.fxRate !== undefined),
    {
      message: "A foreign amount needs the rate that converted it",
      path: ["fxRate"],
    },
  );
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Everything except direction and account, which would rewrite history. */
export const updateTransactionSchema = z
  .strictObject({
    txnDate: isoDateSchema.optional(),
    amount: amountSchema.optional(),
    categoryId: z.string().uuid().optional(),
    vendorId: z.string().uuid().nullish(),
    vendorName: optionalText(120),
    counterparty: optionalText(160),
    paymentMethod: paymentMethodSchema.optional(),
    reference: optionalText(120),
    description: z.string().trim().min(2).max(300).optional(),
    notes: optionalText(1000),
    receiptUrl: receiptUrlSchema,
    billAmount: amountSchema.optional(),
    withheldTaxAmount: amountSchema.optional(),
    usdRate: z
      .string()
      .trim()
      .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const voidTransactionSchema = z.strictObject({
  reason: z.string().trim().min(3, "Say why this is being voided").max(300),
});
export type VoidTransactionInput = z.infer<typeof voidTransactionSchema>;

/** Moving money between our own accounts creates a linked pair of rows. */
export const transferSchema = z
  .strictObject({
    txnDate: isoDateSchema,
    fromAccountId: z.string().uuid("Choose the account money leaves"),
    toAccountId: z.string().uuid("Choose the account money arrives in"),
    amount: amountSchema,
    description: z.string().trim().min(2).max(300),
    reference: optionalText(120),
    paymentMethod: paymentMethodSchema.default("bank_transfer"),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: "Pick two different accounts",
    path: ["toAccountId"],
  });
export type TransferInput = z.infer<typeof transferSchema>;

/* -------------------------------------------------------------------------- */
/*  Filters — shared by the list, the summary, and the Excel export            */
/* -------------------------------------------------------------------------- */

/**
 * The export takes this same schema. That is what makes "the download is
 * exactly what is on screen" structural rather than a promise.
 */
export const transactionFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: z.string().uuid().optional(),
  direction: txnDirectionSchema.optional(),
  categoryId: z.string().uuid().optional(),
  /** Includes the heading's sub-categories too. */
  categorySlug: z.string().trim().max(60).optional(),
  subCategorySlug: z.string().trim().max(60).optional(),
  vendorId: z.string().uuid().optional(),
  paymentMethod: paymentMethodSchema.optional(),
  createdVia: txnOriginSchema.optional(),
  minAmount: amountSchema.optional(),
  maxAmount: amountSchema.optional(),
  hasReceipt: z.coerce.boolean().optional(),
  q: z.string().trim().max(160).optional(),
  includeVoided: z.coerce.boolean().default(false),
});
export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

export const TXN_SORT_FIELDS = [
  "txnDate",
  "amount",
  "description",
  "createdAt",
] as const;

export const listTransactionsQuerySchema = transactionFilterSchema
  .extend(paginationQuerySchema.shape)
  .extend({
    sort: z.enum(TXN_SORT_FIELDS).default("txnDate"),
    order: z.enum(["asc", "desc"]).default("desc"),
  });
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const registerQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

export const expenseSummaryQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Given a heading's slug, break down by its sub-categories instead. */
  categorySlug: z.string().trim().max(60).optional(),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
