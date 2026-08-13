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

export function formatDate(
  input: string | Date,
  style: "short" | "long" = "short",
) {
  const date =
    typeof input === "string" ? new Date(`${input}T00:00:00`) : input;
  return new Intl.DateTimeFormat("en-US", {
    month: style === "long" ? "long" : "short",
    day: "numeric",
    year: style === "long" ? "numeric" : undefined,
  }).format(date);
}
