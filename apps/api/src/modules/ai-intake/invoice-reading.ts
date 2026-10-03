import type { AiInvoiceReading } from "@finance/shared";

import type { DocumentMime, TurnModel } from "./model-turn";

/**
 * A plan's invoice, read for what the plan's row needs from it (4 Oct 2026).
 *
 * The owner had a plan saved through the Assistant and found its Invoice
 * column reading "N/A". An invoice attached in the chat now becomes the
 * plan's invoice file on Confirm, and its number goes in `invoiceNo` — read
 * here, once, when it arrives, as a PDF statement is transcribed when it
 * arrives (pdf-statement.ts). The file itself is not kept on the server
 * until Confirm: the browser uploads it to the plan, as the Add subscription
 * form does.
 *
 * Read, never inferred. A number the model could not read clearly comes back
 * empty, and the Assistant asks for it: an invoice number that is nearly
 * right is a search that finds nothing a year later.
 */
const READ_TOOL = {
  name: "invoice_fields",
  description: "Return what the invoice itself prints, exactly as printed.",
  input_schema: {
    type: "object" as const,
    properties: {
      isInvoice: {
        type: "boolean",
        description:
          "True if this is an invoice, a bill or a receipt for a purchase.",
      },
      number: {
        type: "string",
        description:
          "The invoice or receipt number, exactly as printed. Leave out if none is printed or it cannot be read clearly.",
      },
      date: {
        type: "string",
        description:
          "The invoice date as YYYY-MM-DD. Leave out if not printed or unclear.",
      },
      seller: {
        type: "string",
        description: "Who issued it: the company's name as printed.",
      },
      total: {
        type: "string",
        description:
          "The total charged, digits and a decimal point only, e.g. 100.00. Leave out if unclear.",
      },
      currency: {
        type: "string",
        description: 'The currency of the total as a code, e.g. "USD".',
      },
    },
    required: ["isInvoice"],
  },
};

const INSTRUCTION = `This file was attached as the invoice for a subscription.

Read what it prints and return it through invoice_fields:
- Copy the invoice number EXACTLY as printed, every letter, digit and dash.
- Never guess. If something is not printed, or you cannot read it clearly,
  leave it out. An empty field is asked about; a guessed one is believed.
- The total is the amount charged, as printed, with no currency sign and no
  thousands separators.`;

/** One invoice is a few lines of answer. */
const MAX_OUTPUT_TOKENS = 2_000;

const NOTHING: AiInvoiceReading = {
  number: null,
  date: null,
  seller: null,
  total: null,
  currency: null,
};

export async function readInvoicePaper(
  model: TurnModel,
  file: Buffer,
  mimeType: DocumentMime,
): Promise<AiInvoiceReading> {
  const read = await model.readDocument({
    file,
    mimeType,
    instruction: INSTRUCTION,
    tool: READ_TOOL,
    maxTokens: MAX_OUTPUT_TOKENS,
  });
  return invoiceReadingOf(read.input);
}

/** What came back, held to its shape: anything else is read as not printed. */
export function invoiceReadingOf(input: unknown): AiInvoiceReading {
  if (!input || typeof input !== "object") return NOTHING;
  const raw = input as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const value = raw[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= max ? trimmed : null;
  };
  const date = text("date", 10);
  const total = text("total", 20)?.replace(/,/g, "") ?? null;
  const currency = text("currency", 3)?.toUpperCase() ?? null;
  return {
    // Sixty: what the plan's `invoiceNo` takes.
    number: text("number", 60),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    seller: text("seller", 160),
    total: total && /^\d+(\.\d{1,2})?$/.test(total) ? total : null,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}
