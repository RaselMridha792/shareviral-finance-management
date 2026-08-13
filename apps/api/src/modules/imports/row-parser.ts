import type {
  DateFormat,
  ParsedRow,
  TransactionField,
} from "./imports.schemas";

export type RawRow = Record<string, string | number | null>;

export type ParseResult =
  { ok: true; row: ParsedRow } | { ok: false; errors: string[] };

/**
 * Turns one spreadsheet row into something the ledger will accept.
 *
 * Every failure is collected rather than thrown on the first one, so the
 * preview can show a row's problems together instead of one per attempt.
 */
export function parseRow(
  raw: RawRow,
  columnMap: Record<string, TransactionField | null>,
  defaults: {
    dateFormat: DateFormat;
    assumeDirection?: "in" | "out";
  },
): ParseResult {
  const errors: string[] = [];
  const field = (name: TransactionField): string | undefined => {
    const header = Object.keys(columnMap).find(
      (key) => columnMap[key] === name,
    );
    if (!header) return undefined;
    const value = raw[header];
    if (value === null || value === undefined) return undefined;
    const text = String(value).trim();
    return text === "" ? undefined : text;
  };

  const dateText = field("txnDate");
  const date = dateText ? parseDate(dateText, defaults.dateFormat) : undefined;
  if (!dateText) errors.push("No date");
  else if (!date) errors.push(`Could not read the date "${dateText}"`);

  const description = field("description");
  if (!description) errors.push("No description");

  // Three shapes turn up in real bank exports: separate in/out columns, one
  // signed column, or one unsigned column plus a direction word.
  const inText = field("amountIn");
  const outText = field("amountOut");
  const amountText = field("amount");
  const directionText = field("direction");

  let amount: string | undefined;
  let direction: "in" | "out" | undefined;

  if (inText || outText) {
    const moneyIn = inText ? parseAmount(inText) : undefined;
    const moneyOut = outText ? parseAmount(outText) : undefined;

    if (moneyIn && moneyOut) {
      errors.push("Both the in and out columns have a value");
    } else if (moneyIn) {
      amount = moneyIn;
      direction = "in";
    } else if (moneyOut) {
      amount = moneyOut;
      direction = "out";
    } else {
      errors.push("Neither the in nor the out column has an amount");
    }
  } else if (amountText) {
    const parsed = parseAmount(amountText);
    if (!parsed) {
      errors.push(`Could not read the amount "${amountText}"`);
    } else {
      const negative = parsed.startsWith("-");
      amount = negative ? parsed.slice(1) : parsed;

      if (directionText) {
        direction = readDirection(directionText);
        if (!direction)
          errors.push(`Could not read "${directionText}" as in or out`);
      } else if (negative) {
        direction = "out";
      } else if (defaults.assumeDirection) {
        direction = defaults.assumeDirection;
      } else {
        // Guessing here would silently reverse a month of figures.
        errors.push(
          "No direction — say whether these are money in or money out",
        );
      }
    }
  } else {
    errors.push("No amount");
  }

  if (amount && Number(amount) <= 0)
    errors.push("The amount must be above zero");

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    row: {
      txnDate: date!,
      description: description!,
      amount: amount!,
      direction: direction!,
      categoryName: field("categoryName"),
      vendorName: field("vendorName"),
      reference: field("reference"),
      paymentMethod: field("paymentMethod"),
      notes: field("notes"),
    },
  };
}

/* -------------------------------------------------------------------------- */

/** `৳1,25,000.50`, `(4,500)`, `-4500`, `4 500,50` → `125000.50` etc. */
export function parseAmount(input: string): string | undefined {
  let text = input.trim();
  if (!text) return undefined;

  // Accounting notation: (1,234) means negative.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }

  text = text.replace(/[৳$€£\s]/g, "");

  // A comma may be a thousands separator or a decimal point. If the last comma
  // has exactly two digits after it and there is no dot, treat it as decimal.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot === -1 && text.length - lastComma === 3) {
    text = text.slice(0, lastComma) + "." + text.slice(lastComma + 1);
  } else {
    text = text.replace(/,/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;

  const value = Number(text);
  if (!Number.isFinite(value)) return undefined;

  return `${negative ? "-" : ""}${value.toFixed(2)}`;
}

/** Returns `YYYY-MM-DD`, or undefined when the text cannot be a date. */
export function parseDate(
  input: string,
  format: DateFormat,
): string | undefined {
  const text = input.trim();

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return validate(+iso[1], +iso[2], +iso[3]);

  // Excel serial numbers arrive when a cell was a real date.
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    // Day 1 is 1900-01-01, and Excel wrongly counts 1900 as a leap year.
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return validate(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    );
  }

  const parts = text.split(/[/.\-\s]+/).filter(Boolean);
  if (parts.length < 3) return undefined;

  const [a, b, c] = parts.map((p) => Number(p.replace(/\D/g, "")));
  if ([a, b, c].some((n) => Number.isNaN(n))) return undefined;

  const order =
    format === "auto"
      ? // A value above 12 in the first slot can only be a day.
        a > 12
        ? "dmy"
        : b > 12
          ? "mdy"
          : "dmy" // Bangladesh writes day first.
      : format;

  switch (order) {
    case "ymd":
      return validate(a, b, c);
    case "mdy":
      return validate(fullYear(c), a, b);
    default:
      return validate(fullYear(c), b, a);
  }
}

function fullYear(value: number): number {
  if (value > 1000) return value;
  // A two-digit year is this century unless that would be far in the future.
  return value + (value > 70 ? 1900 : 2000);
}

function validate(
  year: number,
  month: number,
  day: number,
): string | undefined {
  if (year < 1900 || year > 2200) return undefined;
  if (month < 1 || month > 12) return undefined;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function readDirection(text: string): "in" | "out" | undefined {
  const value = text.trim().toLowerCase();
  if (
    ["in", "credit", "cr", "deposit", "received", "receipt"].includes(value)
  ) {
    return "in";
  }
  if (["out", "debit", "dr", "withdrawal", "paid", "payment"].includes(value)) {
    return "out";
  }
  return undefined;
}
