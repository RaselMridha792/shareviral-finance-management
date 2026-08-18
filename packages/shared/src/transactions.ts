import { z } from "zod";
import { boolish } from "./patch.ts";

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

/**
 * The other end of a wire: who sent the money and from where.
 *
 * A remittance advice names the sending bank, the account it left and the
 * name on it — the receiving side of the same transfer is our own account,
 * which is chosen separately. These four describe the *sender*, so a transfer
 * from abroad can be traced back to the company that made it months later.
 *
 * Every one is optional. Cash walked into a branch has no sending bank at all,
 * and plenty of advices arrive without a SWIFT code — refusing the record over
 * a field the bank did not print would lose the entry, not improve it.
 */
const senderFields = {
  senderBankName: optionalText(160),
  senderAccountName: optionalText(160),
  senderAccountNumber: optionalText(64),
  /** SWIFT/BIC of the sending bank. 8 or 11 characters, never validated hard. */
  senderSwiftCode: optionalText(20),
};

export const createTransactionSchema = z
  .strictObject({
    direction: txnDirectionSchema,
    txnDate: isoDateSchema,
    accountId: z.string().uuid("Choose an account"),
    amount: amountSchema.refine((v) => Number(v) > 0, {
      message: "The amount must be more than zero",
    }),
    categoryId: z.string().uuid("Choose a category"),

    /**
     * An existing vendor, by id. Never by name.
     *
     * `vendorName` used to be accepted here and free text created a vendor as
     * a side effect of writing a transaction — unaudited, and behind
     * `transactions.write` rather than `vendors.write`. That is how a supplier
     * called "150000.00" came to exist, from an amount typed into the wrong
     * box. The form that offered it is gone; taking the field out of the
     * contract is what stops the same thing arriving through the API or the
     * assistant.
     *
     * Subscriptions still need the link, and Record payment on the AI tools
     * screen supplies it — by id, against a vendor somebody deliberately
     * created.
     */
    vendorId: z.string().uuid().nullish(),
    counterparty: optionalText(160),

    paymentMethod: paymentMethodSchema.default("bank_transfer"),
    reference: optionalText(120),
    /**
     * The company's own document number — INV-002, SAL-JUL. Separate from
     * `reference`, which is the bank's.
     */
    invoiceNo: optionalText(60),
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

    ...senderFields,
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

/**
 * Money arriving from abroad: an intercompany transfer, recorded off the
 * remittance advice the bank sends.
 *
 * A narrower way of describing the same event, not a second ledger. Everything
 * here is mapped onto `createTransactionSchema` and written by the one service
 * that writes every other row, so a cash-in has the same ref number, the same
 * audit entry and the same place in the register as anything else.
 *
 * Two things are tighter than on the general form. `direction` is not asked —
 * an advice for money arriving cannot describe a payment out. And `usdRate` is
 * required, because this is the entry that sets what a dollar was worth for the
 * whole month: it is the first funded inflow's rate that every later taka
 * figure is read back in. Nobody will know it as precisely again.
 */
export const recordCashInSchema = z.strictObject({
  txnDate: isoDateSchema,

  /** The bank's reference for the wire — what a query about it would quote. */
  reference: optionalText(120),

  /**
   * The invoice this transfer settles. Ours, not the bank's.
   *
   * Optional in the contract even though the Cash In screen asks for it,
   * because the same schema records a local receipt that has no invoice at
   * all. The screen is where "every field is required" belongs; a schema that
   * refuses a true record is a schema that loses it.
   */
  invoiceNo: optionalText(60),

  description: z
    .string()
    .trim()
    .min(2, "Say what this transfer was for")
    .max(300),

  /** One of our own accounts: where the money landed. */
  accountId: z.string().uuid("Choose the account it landed in"),

  /** What actually arrived, in the account's own currency. */
  amount: amountSchema.refine((v) => Number(v) > 0, {
    message: "The amount must be more than zero",
  }),

  categoryId: z.string().uuid("Choose a category"),

  usdRate: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77"),

  /**
   * What the sender actually sent, in dollars — the figure at the top of the
   * advice, before the bank converted anything.
   *
   * Optional, and that is the point: money-in through this form is not always a
   * foreign remittance, and a local receipt must not be blocked by a dollar
   * field it has no answer for. Given, it is what turns the row into a
   * remittance the funding report can see — the report selects on
   * `original_currency = 'USD'` and `original_amount > 0`, columns nothing was
   * filling in before, which is why cash-in rows never appeared there.
   *
   * Only the dollars are asked for. `original_currency` and `fx_rate` follow
   * from them in `TransactionsService.recordCashIn` rather than being sent, so
   * this form cannot describe a euro transfer at a rate of its own choosing.
   */
  usdSent: amountSchema
    .refine((v) => Number(v) > 0, {
      message: "Leave this blank, or enter what was sent in dollars",
    })
    .optional(),

  ...senderFields,

  paymentMethod: paymentMethodSchema.default("bank_transfer"),
  notes: optionalText(1000),
  receiptUrl: receiptUrlSchema,
});
export type RecordCashInInput = z.infer<typeof recordCashInSchema>;

/** Everything except direction and account, which would rewrite history. */
export const updateTransactionSchema = z
  .strictObject({
    txnDate: isoDateSchema.optional(),
    amount: amountSchema.optional(),
    categoryId: z.string().uuid().optional(),
    /** By id only — see `createTransactionSchema`. */
    vendorId: z.string().uuid().nullish(),
    counterparty: optionalText(160),
    paymentMethod: paymentMethodSchema.optional(),
    reference: optionalText(120),
    invoiceNo: optionalText(60),
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
  hasReceipt: boolish.optional(),
  q: z.string().trim().max(160).optional(),
  includeVoided: boolish.default(false),
  /**
   * Drop everything that counts as tooling.
   *
   * "Other expenses" means everything except what renews, and it used to
   * subtract only rows carrying a recurring vendor — while the AI tools screen
   * counts a payment as tooling if it went to a tool vendor **or** left a
   * non-taka account. A ৳39,975 card payment with no vendor named on it
   * therefore appeared on both screens, and the two totals summed to ৳2,72,750
   * against a month that really spent ৳2,32,775.
   *
   * Server-side so both screens ask the same question of the same definition —
   * `isToolSpend()` — rather than one of them approximating it client-side.
   */
  excludeToolSpend: boolish.optional(),
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
  /**
   * Show voided rows too, struck through and out of every total.
   *
   * Off by default so the statement — which builds its ledgers from this same
   * call — keeps counting only live money. The register screen turns it on,
   * because "a voided row stays visible" is the rule everywhere else in the
   * app and the register was the one place it did not hold.
   */
  includeVoided: boolish.optional(),
});
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

export const expenseSummaryQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Given a heading's slug, break down by its sub-categories instead. */
  categorySlug: z.string().trim().max(60).optional(),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;
