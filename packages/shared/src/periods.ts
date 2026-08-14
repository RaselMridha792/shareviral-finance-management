import { z } from "zod";

import {
  firstDayOfMonth,
  isoDate,
  lastDayOfMonth,
  parseIsoDate,
  todayInDhaka,
  type IsoDate,
} from "./datetime.ts";

/**
 * Bangladesh's income year runs 1 July – 30 June, but management often wants
 * the calendar year. Both are supported and the choice is a setting, so every
 * period boundary in the app must come from here rather than being derived
 * ad hoc from a month number.
 */
export const FISCAL_YEAR_MODES = ["bd_july_june", "calendar"] as const;
export const fiscalYearModeSchema = z.enum(FISCAL_YEAR_MODES);
export type FiscalYearMode = z.infer<typeof fiscalYearModeSchema>;

export const GRANULARITIES = ["month", "quarter", "half", "year"] as const;
export const granularitySchema = z.enum(GRANULARITIES);
export type Granularity = z.infer<typeof granularitySchema>;

export type PeriodRange = {
  start: IsoDate;
  end: IsoDate;
  label: string;
  granularity: Granularity;
  /** The fiscal year this period belongs to; its starting calendar year. */
  fiscalYear: number;
};

/** Calendar month names, 0-based like `Date#getMonth`. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The calendar month (1-based) a fiscal year starts in. */
export function fiscalYearStartMonth(mode: FiscalYearMode): number {
  return mode === "bd_july_june" ? 7 : 1;
}

/**
 * The fiscal year a date belongs to, identified by its starting calendar year.
 * In BD mode, 2026-08-12 is in fiscal year 2026 (Jul 2026 – Jun 2027), while
 * 2026-05-12 is in fiscal year 2025.
 */
export function fiscalYearOf(date: IsoDate, mode: FiscalYearMode): number {
  const { year, month } = parseIsoDate(date);
  if (mode === "calendar") return year;
  return month >= 7 ? year : year - 1;
}

/** Label for a fiscal year: "FY 2026-27" in BD mode, "2026" in calendar mode. */
export function fiscalYearLabel(
  fiscalYear: number,
  mode: FiscalYearMode,
): string {
  if (mode === "calendar") return String(fiscalYear);
  const next = String(fiscalYear + 1).slice(-2);
  return `FY ${fiscalYear}-${next}`;
}

export function fiscalYearRange(
  fiscalYear: number,
  mode: FiscalYearMode,
): PeriodRange {
  const startMonth = fiscalYearStartMonth(mode);
  const start = isoDate(fiscalYear, startMonth, 1);
  const end =
    mode === "calendar"
      ? lastDayOfMonth(fiscalYear, 12)
      : lastDayOfMonth(fiscalYear + 1, 6);
  return {
    start,
    end,
    label: fiscalYearLabel(fiscalYear, mode),
    granularity: "year",
    fiscalYear,
  };
}

/**
 * Which position (1-based) a calendar month occupies within the fiscal year.
 * BD mode: July is 1, June is 12.
 */
export function monthIndexInFiscalYear(
  month: number,
  mode: FiscalYearMode,
): number {
  const startMonth = fiscalYearStartMonth(mode);
  return ((month - startMonth + 12) % 12) + 1;
}

export function monthRange(year: number, month: number): PeriodRange {
  return {
    start: firstDayOfMonth(year, month),
    end: lastDayOfMonth(year, month),
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    granularity: "month",
    fiscalYear: year,
  };
}

/**
 * Quarter of a fiscal year, 1-based.
 * BD mode: Q1 = Jul–Sep, Q2 = Oct–Dec, Q3 = Jan–Mar, Q4 = Apr–Jun — the
 * statutory quarters the withholding return is filed against.
 */
export function quarterRange(
  fiscalYear: number,
  quarter: 1 | 2 | 3 | 4,
  mode: FiscalYearMode,
): PeriodRange {
  const startMonth = fiscalYearStartMonth(mode);
  const offset = (quarter - 1) * 3;
  const rawStart = startMonth + offset;
  const startYear = fiscalYear + Math.floor((rawStart - 1) / 12);
  const startMonthNumber = ((rawStart - 1) % 12) + 1;

  const rawEnd = rawStart + 2;
  const endYear = fiscalYear + Math.floor((rawEnd - 1) / 12);
  const endMonthNumber = ((rawEnd - 1) % 12) + 1;

  return {
    start: isoDate(startYear, startMonthNumber, 1),
    end: lastDayOfMonth(endYear, endMonthNumber),
    label: `Q${quarter} ${fiscalYearLabel(fiscalYear, mode)}`,
    granularity: "quarter",
    fiscalYear,
  };
}

export function halfRange(
  fiscalYear: number,
  half: 1 | 2,
  mode: FiscalYearMode,
): PeriodRange {
  const startMonth = fiscalYearStartMonth(mode);
  const offset = (half - 1) * 6;
  const rawStart = startMonth + offset;
  const startYear = fiscalYear + Math.floor((rawStart - 1) / 12);
  const startMonthNumber = ((rawStart - 1) % 12) + 1;

  const rawEnd = rawStart + 5;
  const endYear = fiscalYear + Math.floor((rawEnd - 1) / 12);
  const endMonthNumber = ((rawEnd - 1) % 12) + 1;

  return {
    start: isoDate(startYear, startMonthNumber, 1),
    end: lastDayOfMonth(endYear, endMonthNumber),
    label: `H${half} ${fiscalYearLabel(fiscalYear, mode)}`,
    granularity: "half",
    fiscalYear,
  };
}

/** Which fiscal quarter a date falls in. */
export function quarterOf(
  date: IsoDate,
  mode: FiscalYearMode,
): { fiscalYear: number; quarter: 1 | 2 | 3 | 4 } {
  const { month } = parseIsoDate(date);
  const fiscalYear = fiscalYearOf(date, mode);
  const index = monthIndexInFiscalYear(month, mode);
  return {
    fiscalYear,
    quarter: Math.ceil(index / 3) as 1 | 2 | 3 | 4,
  };
}

/** Every month range inside a fiscal year, in fiscal order. */
export function monthsInFiscalYear(
  fiscalYear: number,
  mode: FiscalYearMode,
): PeriodRange[] {
  const startMonth = fiscalYearStartMonth(mode);
  return Array.from({ length: 12 }, (_, i) => {
    const raw = startMonth + i;
    const year = fiscalYear + Math.floor((raw - 1) / 12);
    const month = ((raw - 1) % 12) + 1;
    return monthRange(year, month);
  });
}

/**
 * How many periods of this size fit in a fiscal year.
 *
 * A single `index` field has to carry 1-12 for months and 1-4 for quarters, so
 * its own `max` cannot tell a valid quarter from an invalid one. This is what
 * the query schemas check `index` against.
 */
export function periodsPerFiscalYear(granularity: Granularity): number {
  switch (granularity) {
    case "month":
      return 12;
    case "quarter":
      return 4;
    case "half":
      return 2;
    case "year":
      return 1;
  }
}

/** Plural noun for a granularity, for messages people read. */
const GRANULARITY_PLURAL: Record<Granularity, string> = {
  month: "months",
  quarter: "quarters",
  half: "halves",
  year: "year",
};

/**
 * Why this `index` cannot be asked for, or null when it can.
 *
 * Report requests used to clamp instead: asking for quarter 9 quietly answered
 * with quarter 4. The label was honest, but a figure nobody asked for is not
 * something a finance report should hand back without saying so.
 */
export function periodIndexIssue(
  granularity: Granularity,
  index: number | undefined,
): string | null {
  if (index === undefined) return null;
  const available = periodsPerFiscalYear(granularity);
  if (index <= available) return null;
  return granularity === "year"
    ? "A financial year has only one yearly period, so index must be 1."
    : `A financial year has ${available} ${GRANULARITY_PLURAL[granularity]} — there is no ${granularity} ${index}.`;
}

/**
 * The cross-field half of validating a report request, shared by every query
 * that carries a `granularity` and an `index`.
 */
export function checkPeriodIndex(
  value: { granularity: Granularity; index?: number },
  ctx: z.RefinementCtx,
): void {
  const issue = periodIndexIssue(value.granularity, value.index);
  if (issue) ctx.addIssue({ code: "custom", message: issue, path: ["index"] });
}

/** Every sub-period of a fiscal year at the given granularity. */
export function periodsInFiscalYear(
  fiscalYear: number,
  mode: FiscalYearMode,
  granularity: Granularity,
): PeriodRange[] {
  switch (granularity) {
    case "month":
      return monthsInFiscalYear(fiscalYear, mode);
    case "quarter":
      return ([1, 2, 3, 4] as const).map((q) =>
        quarterRange(fiscalYear, q, mode),
      );
    case "half":
      return ([1, 2] as const).map((h) => halfRange(fiscalYear, h, mode));
    case "year":
      return [fiscalYearRange(fiscalYear, mode)];
  }
}

/** The fiscal year containing today, in Dhaka. */
export function currentFiscalYear(
  mode: FiscalYearMode,
  today: IsoDate = todayInDhaka(),
): number {
  return fiscalYearOf(today, mode);
}

export function isWithin(date: IsoDate, range: PeriodRange): boolean {
  return date >= range.start && date <= range.end;
}
