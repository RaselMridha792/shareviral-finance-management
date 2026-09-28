import { BadRequestException } from "@nestjs/common";
import { fromMinorUnits, isValidAmount } from "@finance/shared";
import { z } from "zod";

/**
 * An invoice as the Invoice Builder holds it — the web's `InvoiceDraft`
 * (apps/web/src/components/invoice-builder/invoice-draft.ts), checked.
 *
 * Kept here rather than in the shared package: nothing else reads it, and the
 * builder's shape is the builder's. What the server adds is the part the
 * browser cannot be trusted with — the total, worked out again in paisa from
 * the items — and the limits that keep one row from growing without end.
 */

export const INVOICE_STATUSES = [
  "SENT",
  "PAID",
  "UNPAID",
  "DRAFT",
  "OVERDUE",
] as const;

/**
 * An uploaded logo as a data URL, after the builder has scaled it to the size
 * it prints at (a few tens of KB).
 *
 * The cap is set by the request, not the picture: the API reads JSON bodies
 * up to Express's 100 KB, and one past it is refused before this code runs.
 * An invoice's own text is a few KB; the logo is what could push it over.
 */
const MAX_LOGO_CHARS = 80_000;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour like #0a0a0a");
const isoOrEmpty = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "A date, or nothing");
const size = z.number().min(8).max(28);
const rowId = z.number().int().nonnegative();

const textLine = z.object({
  id: rowId,
  text: z.string().max(300),
  bold: z.boolean(),
  size,
});

const payLine = z.object({
  id: rowId,
  label: z.string().max(80),
  value: z.string().max(300),
  bold: z.boolean(),
  size,
});

const lineItem = z.object({
  id: rowId,
  description: z.string().max(500),
  qty: z.string().max(20),
  price: z.string().max(30),
});

export const invoiceDocumentSchema = z.object({
  v: z.literal(1),
  logo: z
    .string()
    .max(MAX_LOGO_CHARS, "That logo is too large. Use a smaller image.")
    .refine((value) => value.startsWith("data:image/"), "Not an image")
    .nullable(),
  companyName: z.string().max(160),
  tagline: z.string().max(200),
  /** The dark tiles: the logo's, the table head's, the total's. */
  background: hex,
  /** The title, the bold bill lines, the project title, Payment Terms. */
  heading: hex,
  accent: hex,
  status: z.enum(INVOICE_STATUSES),

  number: z
    .string()
    .trim()
    .min(1, "Give the invoice a number")
    .max(60, "Keep the number under 60 characters"),
  issuedOn: isoOrEmpty,
  dueOn: isoOrEmpty,
  currencyLabel: z.string().max(60),
  salesPeriod: z.string().max(80),
  showUsd: z.boolean(),
  usdRate: z.string().max(20),

  billTo: z.array(textLine).min(1).max(30),
  billFrom: z.array(textLine).min(1).max(30),

  projectTitle: z.string().max(200),
  items: z.array(lineItem).min(1).max(100),

  payTerms: z.string().max(120),
  pay: z.array(payLine).min(1).max(30),

  notes: z.string().max(4000),

  hidden: z.object({
    meta: z.boolean(),
    bill: z.boolean(),
    terms: z.boolean(),
    bank: z.boolean(),
    notes: z.boolean(),
  }),
  nextId: z.number().int().nonnegative(),
});

export type InvoiceDocument = z.infer<typeof invoiceDocumentSchema>;

export const saveInvoiceSchema = z.object({
  document: invoiceDocumentSchema,
});
export type SaveInvoiceInput = z.infer<typeof saveInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  What the list reads out of a document                                      */
/* -------------------------------------------------------------------------- */

/* `BigInt(…)` to match the web's copy of this arithmetic, which compiles to
   a target without bigint literals. */
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);
const QTY = /^\d{1,7}(\.\d{1,3})?$/;

function plain(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}

/**
 * The columns a saved invoice carries beside its document.
 *
 * The total is the builder's arithmetic done again here — price × quantity per
 * line in integer paisa, half up, summed — so the figure the list shows is the
 * server's, whatever the browser sent. A line whose price or quantity is not a
 * number is refused by name rather than counted as nothing: the web marks it,
 * and an invoice saved with a line silently worth ৳0 is an invoice for the
 * wrong amount.
 */
export function readInvoice(document: InvoiceDocument) {
  let total = ZERO;
  document.items.forEach((item, index) => {
    const priceText = plain(item.price);
    const qtyText = item.qty.trim();
    if (
      priceText !== "" &&
      (!isValidAmount(priceText) || priceText.startsWith("-"))
    ) {
      throw new BadRequestException(
        `Item ${index + 1}: the unit price "${item.price}" is not an amount.`,
      );
    }
    if (qtyText !== "" && !QTY.test(qtyText)) {
      throw new BadRequestException(
        `Item ${index + 1}: the quantity "${item.qty}" is not a number (up to 3 decimals).`,
      );
    }
    const [whole = "0", fraction = ""] = (priceText || "0").split(".");
    const price = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, "0"));
    const [qWhole = "0", qFraction = ""] = (qtyText || "0").split(".");
    const qty = BigInt(qWhole) * THOUSAND + BigInt(qFraction.padEnd(3, "0"));
    total += (price * qty + HALF_THOUSAND) / THOUSAND;
  });

  const totalAmount = fromMinorUnits(total);
  if (!isValidAmount(totalAmount)) {
    throw new BadRequestException(
      "That invoice comes to more than the books can hold.",
    );
  }

  const rate = Number(plain(document.usdRate));
  return {
    invoiceNumber: document.number.trim(),
    status: document.status,
    clientName:
      document.billTo.map((line) => line.text.trim()).find(Boolean) ?? null,
    issuedOn: document.issuedOn || null,
    dueOn: document.dueOn || null,
    totalAmount,
    usdRate:
      Number.isFinite(rate) && rate > 0 && rate < 1_000_000
        ? String(rate)
        : null,
  };
}
