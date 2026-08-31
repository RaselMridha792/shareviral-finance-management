import { formatIsoDate } from "@finance/shared";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * U+2212 MINUS SIGN, not the ASCII hyphen. In a mono font the true minus has
 * the same advance width as the plus, so signed columns stay aligned.
 */
export const MINUS = "−";
export const PLUS = "+";

export function formatCurrency(
  value: number,
  currency = "USD",
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...options,
  }).format(value);
}

/**
 * Amount with an explicit leading sign, e.g. "+ 82,000.00" / "− 12,400.00".
 *
 * Colour alone is not a signal: colourblind users, printed statements, and
 * greyscale screenshots all lose it. The sign survives all three.
 */
export function formatSignedCurrency(
  value: number,
  currency = "USD",
  options: Intl.NumberFormatOptions = {},
) {
  const sign = value < 0 ? MINUS : PLUS;
  return `${sign} ${formatCurrency(Math.abs(value), currency, options)}`;
}

/** Unsigned magnitude plus the sign for a known direction. */
export function signFor(direction: "credit" | "debit") {
  return direction === "credit" ? PLUS : MINUS;
}

/** "$12.4k" style output for tight spaces like axis ticks. */
export function formatCompactCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 1) {
  const sign = value < 0 ? MINUS : PLUS;
  return `${sign}${Math.abs(value).toFixed(fractionDigits)}%`;
}

/**
 * Day, then month, then year — the way it is read here.
 *
 * It used to be `Intl.DateTimeFormat("en-US")`, which prints "May 14": an
 * American month-first reading, and one that dropped the year entirely in its
 * short form. The owner asked for the whole system to read day/month/year, so
 * the decision moved into `@finance/shared` where the API's PDFs and
 * spreadsheets can obey the same rule, and this is the web app's door to it.
 *
 * The `style` argument is gone rather than kept and ignored. Nothing passed
 * it, and a parameter that quietly does nothing is how a screen ends up
 * looking different from the one beside it.
 */
export function formatDate(
  /*
   * Null and undefined are accepted, not guarded against at each call site.
   * Half the date columns in this app are nullable — an end date, a renewal, a
   * date of birth nobody has typed — and thirty `? formatDate(x) : "—"` checks
   * is thirty chances to write a different dash.
   */
  input: string | Date | null | undefined,
): string {
  if (input instanceof Date) {
    // A Date has no timezone of its own; read the calendar day it points at
    // rather than shifting it through a locale on the way out.
    const iso = `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, "0")}-${String(input.getDate()).padStart(2, "0")}`;
    return formatIsoDate(iso);
  }
  return formatIsoDate(input);
}
