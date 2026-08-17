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

/**
 * When this company's books begin: May 2026.
 *
 * The other end of every period picker. A picker bounded only at the top still
 * offers April 2026, 2019, and 1998 — months with no entries, which read as a
 * finding rather than as an absence, and which somebody will eventually create
 * a payroll run or a tax record against.
 *
 * A constant rather than the earliest transaction in the ledger, and
 * deliberately: an empty database would collapse the range to nothing, and a
 * back-dated correction entered later must not silently widen what the pickers
 * offer. When the company one day imports older history, this is the one line
 * that moves.
 */
export const RECORDS_START = { year: 2026, month: 5 } as const;

/** Before the books begin, so there is nothing there to look at. */
export function isBeforeRecords(year: number, month: number): boolean {
  return (
    year < RECORDS_START.year ||
    (year === RECORDS_START.year && month < RECORDS_START.month)
  );
}

/** Before the first year the books cover. */
export function isBeforeRecordYear(year: number): boolean {
  return year < RECORDS_START.year;
}

/**
 * Every year a picker may offer: 2026 up to this one, growing on its own.
 *
 * Newest first, because a year picker is nearly always used to pick this year
 * or last year and a list that starts in 2026 puts those at the bottom.
 */
export function recordYears(now: Date = new Date()): number[] {
  const [thisYear] = todayInDhaka(now).split("-").map(Number);
  const years: number[] = [];
  for (let year = Math.max(thisYear, RECORDS_START.year); year >= RECORDS_START.year; year--) {
    years.push(year);
  }
  return years;
}

/**
 * Is this month one the app can show figures for at all?
 *
 * The single question a picker asks about each of its twelve options. Not
 * offered is different from not chosen: the option stays visible and greyed, so
 * somebody looking for September can see that September exists and is not yet
 * available, rather than wondering whether the app has lost it.
 */
export function isSelectableMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): boolean {
  return !isFutureMonth(year, month, now) && !isBeforeRecords(year, month);
}

/**
 * The closest month in a given year that can actually be shown.
 *
 * For when the *year* changes and strands the month: on March 2027, switching
 * the year to 2026 asks for March 2026, which is before the books begin. The
 * picker greys that option out, but it was already selected, so nothing stops
 * the pair. Clamping means a year change always lands somewhere real.
 *
 * Clamps to the near end in each direction — May for a year that starts
 * mid-way, this month for the year that is running — so the answer is always
 * the closest real month rather than an arbitrary January.
 */
export function nearestSelectableMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): number {
  if (isBeforeRecords(year, month)) return RECORDS_START.month;
  if (isFutureMonth(year, month, now)) {
    const [thisYear, thisMonth] = todayInDhaka(now).split("-").map(Number);
    // A whole future year has no months at all; December is the least
    // surprising thing to point at, and the year itself is not offered anyway.
    return year === thisYear ? thisMonth : 12;
  }
  return month;
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
