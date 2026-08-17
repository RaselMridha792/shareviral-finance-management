/**
 * Everything in this app happens in Bangladesh time (UTC+6, no DST).
 *
 * A server running UTC is six hours behind Dhaka, so `new Date()` on 1 August
 * at 03:00 Dhaka is still 31 July in UTC — and the entry lands in the wrong
 * month's report. Every "today" and every period boundary goes through here.
 */

export const DHAKA_TIME_ZONE = "Asia/Dhaka";

/** An ISO calendar date, `YYYY-MM-DD`. Matches Postgres `date`. */
export type IsoDate = string;

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DHAKA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Dhaka, as `YYYY-MM-DD`. */
export function todayInDhaka(now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return isoDateFormatter.format(now);
}

/**
 * Is this calendar month still ahead of us?
 *
 * Every period picker in the app offers a whole year of months, so on the 17th
 * of August somebody could open September and read a page of zeroes as though
 * it were a finding. Worse on the ones that write: a payroll run for a month
 * that has not happened, or a report exported for a period with nothing in it.
 *
 * Judged in Dhaka. On a laptop set to UTC, for the first six hours of the 1st,
 * the browser's own month is still the previous one — so a picker that asked
 * the browser would open the new month to nobody for a morning a month.
 *
 * The month that is running is *not* future: it is the one everybody works in.
 */
export function isFutureMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): boolean {
  const [thisYear, thisMonth] = todayInDhaka(now).split("-").map(Number);
  return year > thisYear || (year === thisYear && month > thisMonth);
}

/** The same question about a whole year. */
export function isFutureYear(year: number, now: Date = new Date()): boolean {
  const [thisYear] = todayInDhaka(now).split("-").map(Number);
  return year > thisYear;
}

/** Builds `YYYY-MM-DD` from calendar parts, with no timezone involved at all. */
export function isoDate(year: number, month: number, day: number): IsoDate {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function parseIsoDate(value: IsoDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Not an ISO date: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** Days in a given month. `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastDayOfMonth(year: number, month: number): IsoDate {
  return isoDate(year, month, daysInMonth(year, month));
}

export function firstDayOfMonth(year: number, month: number): IsoDate {
  return isoDate(year, month, 1);
}

/**
 * Adds days to an ISO date. Uses UTC internally so no timezone shift can occur;
 * the input and output are both plain calendar dates.
 */
export function addDays(value: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return isoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseIsoDate(value);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = (((targetMonthIndex % 12) + 12) % 12) + 1;
  // Clamp so 31 Jan + 1 month is 28/29 Feb rather than spilling into March.
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return isoDate(targetYear, targetMonth, clampedDay);
}

/** Negative when `a` is earlier, positive when later, 0 when equal. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}

export function isAfter(a: IsoDate, b: IsoDate): boolean {
  return a > b;
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = parseIsoDate(a);
  const pb = parseIsoDate(b);
  const ms =
    Date.UTC(pb.year, pb.month - 1, pb.day) -
    Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86_400_000);
}
