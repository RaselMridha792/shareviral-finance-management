import { toMinorUnits, todayInDhaka } from "@finance/shared";
import { z } from "zod";

/**
 * Standard Chartered's S2B bulk payment format, as the bank hands it out.
 *
 * The owner's two files from the bank (29 Sep 2026): "Bank Standard Format
 * Final-R1.xlsx" — 44 columns, A to AR — and "Preparing Excel File.pdf",
 * which says what goes where:
 *
 *   - Row 1 holds the column names, row 2 is `H`, `P`; each payment is a `P`
 *     row; the last row is `T`. Before upload row 1 is deleted and the sheet
 *     saved as "CSV (Comma delimited)".
 *   - B, payment type: ACH = BEFTN, BT = SCB to SCB, RTGS, PAY = payroll.
 *   - C `ON`, G `BD`, H the debit account's city (`DHK`) — the same on every
 *     row of the bank's own sample.
 *   - I, the debit account: two zeros, then the number
 *     (01122334401 → 0001122334401).
 *   - J, the value date, DD/MM/YYYY, today or later.
 *   - K, the beneficiary's name as the account holds it.
 *   - P, their bank: SCBLBDDXXXX for an SCB account, otherwise two zeros and
 *     the routing number (240100436 → 00240100436).
 *   - T, their account number: digits only.
 *   - U, what it is for — it prints on their statement.
 *   - AL, AM: currency and amount. AR: an email, optional; the bank sends a
 *     confirmation to it.
 *
 * Every other column stays empty. The CSV writes all 44 on every row, as
 * Excel does when it saves the sheet — the bank's template carries a cell in
 * every column of every row, the H and T rows included.
 *
 * Both files come from the same row values (`cellsOf`, `edge`): the CSV
 * here, and the bank's own workbook filled in `bank-workbook.ts`. Deleting
 * row 1 of that workbook and saving it as "CSV (Comma delimited)", as the
 * bank's instructions say, gives the CSV this file writes.
 */

export const PAYMENT_TYPES = ["PAY", "ACH", "BT", "RTGS"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const SCB_CODE = "SCBLBDDXXXX";

/** The bank's column names, A to AR, exactly as its sheet has them. */
export const COLUMN_NAMES = [
  "Record Type",
  "Payment Type",
  "Processing Mode",
  "Service Type",
  "Customer Reference",
  "Customer Memo",
  "Debit A/C Country Code",
  "Debit A/C City Code",
  "Debit A/C No.",
  "Payment/Value Date",
  "Payee/Beneficiary Name in BO*",
  "Payee Address1 in BO*",
  "Payee Address2 in BO*",
  "Payee Address3 in BO*",
  "Payee Fax Number*",
  "Payee/Beneficiary Bank Code* ",
  "Payee bank local clearing code*",
  "Payee branch code*",
  "Payee branch sub-code*",
  "Payee/Beneficiary A/C No.*",
  "Payment Details",
  "Payment Details2 in BO",
  "VAT Amount",
  "WHT Printing Location",
  "WHT Form ID",
  "WHT TaxID*",
  "WHT Reference Number",
  "WHT Type1",
  "WHT Description1",
  "WHT Gross Amount1",
  "WHT Amount1",
  "WHT Type2",
  "WHT Description2",
  "WHT Gross Amount2",
  "WHT Amount2",
  "Discount Amount",
  "Invoice Format",
  "Payment Currency",
  "Payment amount",
  "Local charges to",
  "Overseas charges to",
  "Intermediary bank code*",
  "Clearing Code for TT*",
  "Beneficiary Email ID",
] as const;

/** Where each field sits, by column letter turned into an index. */
const COL = {
  recordType: 0, // A
  paymentType: 1, // B
  processingMode: 2, // C
  countryCode: 6, // G
  cityCode: 7, // H
  debitAccount: 8, // I
  valueDate: 9, // J
  name: 10, // K
  bankCode: 15, // P
  accountNo: 19, // T
  details: 20, // U
  currency: 37, // AL
  amount: 38, // AM
  email: 43, // AR
} as const;

/** The one column the bank's sheet holds as a number; every other is text. */
export const AMOUNT_COLUMN = COL.amount;

/** Column P, which the workbook holds as text so its leading zeros stay. */
export const BANK_CODE_COLUMN = COL.bankCode;

/* -------------------------------------------------------------------------- */
/*  Cleaning what is typed                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A bank code as the file wants it. SCB in any spelling that starts SCBL
 * becomes SCBLBDDXXXX; nine digits of routing number get their two zeros; a
 * code that already has them is left alone. Anything else is kept as typed,
 * for `lineProblems` to name.
 */
export function cleanBankCode(input: string | null | undefined): string {
  const text = (input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s'.-]/g, "");
  if (!text) return "";
  if (text.startsWith("SCBL")) return SCB_CODE;
  if (/^\d{9}$/.test(text)) return `00${text}`;
  return text;
}

/** Digits only: the bank's "no space or dots". */
export function cleanAccountNo(input: string | null | undefined): string {
  return (input ?? "").replace(/[\s.'\-/]/g, "").trim();
}

/**
 * The debit account as column I wants it: two zeros, then the number. A
 * number that already starts with the two zeros is left as it is.
 *
 * Every way a debit account reaches a file goes through this — picked from
 * Accounts, typed on the advice, or read back from an advice saved before
 * the typed one was given its zeros (#123).
 */
export function debitAccountNoOf(accountNumber: string | null | undefined) {
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("00") ? digits : `00${digits}`;
}

/** Whether an account is at Standard Chartered, from what the record holds. */
export function isScb(bankName: string | null, swift: string | null): boolean {
  if (swift && swift.trim().toUpperCase().startsWith("SCBL")) return true;
  return /standard\s*chartered|\bscb\b/i.test(bankName ?? "");
}

/* -------------------------------------------------------------------------- */
/*  What makes a line, or a file, not ready                                    */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* The bank's "CSV (Comma delimited)" is a single-byte file. A name in Bangla,
   a curly apostrophe, an em dash — none of them survive the trip. */
const PLAIN = /^[\x20-\x7E]*$/;

export type LineForCheck = {
  paymentType: string;
  beneficiaryName: string;
  bankCode: string;
  accountNo: string;
  paymentDetails: string;
  amount: string;
  email: string | null;
};

/** Every reason this line cannot go in the file yet, in words. */
export function lineProblems(line: LineForCheck): string[] {
  const problems: string[] = [];
  const name = line.beneficiaryName.trim();
  if (!name) problems.push("No beneficiary name");
  else if (!PLAIN.test(name))
    problems.push("The name has characters the bank's file cannot carry");

  if (!line.accountNo) problems.push("No account number");
  else if (!/^\d{6,20}$/.test(line.accountNo))
    problems.push("The account number must be digits only");

  if (!line.bankCode) {
    problems.push(
      "No bank code — SCBLBDDXXXX for an SCB account, or the routing number",
    );
  } else if (line.bankCode !== SCB_CODE && !/^00\d{9}$/.test(line.bankCode)) {
    problems.push(
      "The bank code must be SCBLBDDXXXX or a 9-digit routing number",
    );
  } else if (line.paymentType === "BT" && line.bankCode !== SCB_CODE) {
    problems.push("BT is SCB to SCB — this account is at another bank");
  } else if (
    (line.paymentType === "ACH" || line.paymentType === "RTGS") &&
    line.bankCode === SCB_CODE
  ) {
    problems.push(
      `${line.paymentType} is for another bank — use BT or PAY for an SCB account`,
    );
  }

  if (!(Number(line.amount) > 0))
    problems.push("The amount must be above zero");

  const details = line.paymentDetails.trim();
  if (!details)
    problems.push("No payment details — the bank prints them on the statement");
  else if (!PLAIN.test(details))
    problems.push("The details have characters the bank's file cannot carry");

  if (line.email && (!EMAIL.test(line.email) || !PLAIN.test(line.email)))
    problems.push("Not an email address");

  return problems;
}

export function adviceProblems(advice: {
  debitAccountNo: string;
  debitCityCode: string;
  valueDate: string | null;
  lineCount: number;
}): string[] {
  const problems: string[] = [];
  /*
   * Column I is the account at Standard Chartered the money leaves, and the
   * bank's instructions show its one shape: 01122334401 written as
   * 0001122334401 — two zeros and the 11 digits, 13 in all; its sample file
   * holds 0007433000443. A number that has lost a zero on the way (10
   * digits, from a spreadsheet that read it as a figure) would be written
   * with its two zeros and still be wrong, so the length is checked too.
   */
  if (!advice.debitAccountNo)
    problems.push("The account it is paid from has no account number");
  else if (!/^00\d{11}$/.test(advice.debitAccountNo))
    problems.push(
      "The debit account must be the 11-digit Standard Chartered number, which the file writes with two zeros in front — 01122334401 as 0001122334401",
    );
  if (!/^[A-Z]{3}$/.test(advice.debitCityCode))
    problems.push("The debit city code must be three letters, like DHK");
  if (!advice.valueDate) problems.push("No value date");
  else if (advice.valueDate < todayInDhaka())
    /* The bank's instructions: "It can be present or future date." */
    problems.push(
      "The value date has passed — the bank takes today or a later date",
    );
  if (advice.lineCount === 0) problems.push("There are no payments in it");
  return problems;
}

/* -------------------------------------------------------------------------- */
/*  Input                                                                      */
/* -------------------------------------------------------------------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date");

export const lineInputSchema = z.object({
  paymentType: z.enum(PAYMENT_TYPES),
  beneficiaryName: z.string().trim().min(1, "Who is being paid").max(140),
  bankCode: z.string().max(20).default(""),
  accountNo: z.string().max(34).default(""),
  paymentDetails: z.string().trim().max(140).default(""),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, "An amount like 25000 or 25000.50"),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .nullable()
    .transform((value) => value || null),
});
export type LineInput = z.infer<typeof lineInputSchema>;

export const fromPayrollSchema = z.object({
  payrollRunId: z.string().uuid(),
  valueDate: isoDate,
  /** What prints on each person's statement — "Salary September 2026". */
  paymentDetails: z.string().trim().min(1).max(140),
  paymentType: z.enum(PAYMENT_TYPES).default("PAY"),
  /** The account it leaves from; the salary sheet's own when absent. */
  accountId: z.string().uuid().optional(),
  /** Fill each person's email, so the bank sends them a confirmation. */
  includeEmails: z.boolean().default(false),
  title: z.string().trim().max(160).optional(),
});
export type FromPayrollInput = z.infer<typeof fromPayrollSchema>;

export const adviceInputSchema = z.object({
  title: z.string().trim().min(1, "Give it a name").max(160),
  accountId: z.string().uuid().nullable().optional(),
  /** Typed when the account has no number on file, or to override it. */
  debitAccountNo: z.string().trim().max(24).optional(),
  debitCityCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Three letters, like DHK")
    .default("DHK"),
  valueDate: isoDate,
  note: z.string().trim().max(500).nullable().optional(),
});
export type AdviceInput = z.infer<typeof adviceInputSchema>;

export const listAdvicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});
export type ListAdvicesQuery = z.infer<typeof listAdvicesQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  The files                                                                  */
/* -------------------------------------------------------------------------- */

export type FileAdvice = {
  debitAccountNo: string;
  debitCityCode: string;
  valueDate: string;
};

export type FileLine = {
  paymentType: string;
  beneficiaryName: string;
  bankCode: string;
  accountNo: string;
  paymentDetails: string;
  currency: string;
  amount: string;
  email: string | null;
};

/** 2026-09-23 → 23/09/2026, the bank's J column. */
function bankDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * An amount as Excel writes a number it was typed as: 100000, 10, 1234.5 —
 * the bank's own sample holds 100000, not 100000.00. Read through paisa, so
 * no float touches it.
 */
function bankAmount(amount: string): string {
  const minor = toMinorUnits(amount);
  const hundred = BigInt(100);
  const whole = (minor / hundred).toString();
  const paisa = (minor % hundred).toString().padStart(2, "0");
  if (paisa === "00") return whole;
  return `${whole}.${paisa.replace(/0$/, "")}`;
}

/** One P row's 44 values, A to AR, as text; "" where the bank leaves it. */
export function cellsOf(advice: FileAdvice, line: FileLine): string[] {
  const cells = new Array<string>(COLUMN_NAMES.length).fill("");
  cells[COL.recordType] = "P";
  cells[COL.paymentType] = line.paymentType;
  cells[COL.processingMode] = "ON";
  cells[COL.countryCode] = "BD";
  cells[COL.cityCode] = advice.debitCityCode;
  cells[COL.debitAccount] = advice.debitAccountNo;
  cells[COL.valueDate] = bankDate(advice.valueDate);
  cells[COL.name] = line.beneficiaryName.trim();
  cells[COL.bankCode] = line.bankCode;
  cells[COL.accountNo] = line.accountNo;
  cells[COL.details] = line.paymentDetails.trim();
  cells[COL.currency] = line.currency;
  cells[COL.amount] = bankAmount(line.amount);
  cells[COL.email] = line.email ?? "";
  return cells;
}

/** The H row above the payments, or the T row below them. */
export function edge(record: "H" | "T"): string[] {
  const cells = new Array<string>(COLUMN_NAMES.length).fill("");
  cells[0] = record;
  if (record === "H") cells[1] = "P";
  return cells;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The file that is uploaded to S2B: the H row, a P row per payment, the T
 * row — no column names, which the bank's instructions say to delete before
 * saving. CRLF and no byte-order mark, as Excel's "CSV (Comma delimited)"
 * writes it.
 */
export function buildCsv(advice: FileAdvice, lines: FileLine[]): Buffer {
  const rows = [
    edge("H"),
    ...lines.map((line) => cellsOf(advice, line)),
    edge("T"),
  ];
  const text = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  return Buffer.from(`${text}\r\n`, "utf8");
}

/** A header value may only hold Latin-1 — see exports.controller.ts. */
export function disposition(filename: string): string {
  const plain = filename.replace(/[^ -~]/g, "-").replace(/"/g, "'");
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
