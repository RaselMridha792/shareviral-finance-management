import {
  addDays,
  daysInMonth,
  isoDate,
  lastDayOfMonth,
  parseIsoDate,
  todayInDhaka,
  type IsoDate,
} from "./datetime.ts";

/**
 * Bangladesh statutory deadlines, as of the Finance Act 2026.
 *
 * The app records tax rather than computing it, so nothing here calculates a
 * rate — these are the dates the dashboard's "what's still pending" list and
 * the reminder logic are built from.
 */

export type DeadlineKind =
  "tds_deposit" | "withholding_return" | "advance_tax" | "income_tax_return";

export type Deadline = {
  kind: DeadlineKind;
  dueOn: IsoDate;
  label: string;
  /** What the deadline covers, e.g. "July 2026" or "Q1 FY 2026-27". */
  periodLabel: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
};

/* -------------------------------------------------------------------------- */
/*  TDS deposit                                                                */
/* -------------------------------------------------------------------------- */

/**
 * When tax deducted on a given date must reach the treasury.
 *
 * Normal rule: within two weeks of the end of the month of deduction.
 * June is special, and this is the part everyone gets wrong:
 *   - deducted 1–20 June  → within 7 days of the deduction
 *   - deducted 21–28 June → the next day
 *   - deducted 29–30 June → the same day
 *
 * The June rules key off the **deduction date**, not the month end, which is
 * why this takes a date rather than a year/month pair.
 */
export function tdsDepositDueDate(deductionDate: IsoDate): IsoDate {
  const { year, month, day } = parseIsoDate(deductionDate);

  if (month === 6) {
    if (day >= 29) return deductionDate;
    if (day >= 21) return addDays(deductionDate, 1);
    return addDays(deductionDate, 7);
  }

  // Two weeks from the end of the month of deduction.
  return addDays(lastDayOfMonth(year, month), 14);
}

/**
 * The deposit deadline for a whole month of deductions.
 *
 * For June this returns the **earliest** deadline in the month (the 29th–30th
 * same-day rule), because that is the date the reminder must fire on — a single
 * "due 14 July" for June would be wrong for most of the month's deductions.
 */
export function tdsDepositDeadlineForMonth(
  year: number,
  month: number,
): Deadline {
  const periodStart = isoDate(year, month, 1);
  const periodEnd = lastDayOfMonth(year, month);
  const dueOn =
    month === 6
      ? isoDate(year, 6, daysInMonth(year, 6)) // last day of June: same-day rule
      : addDays(periodEnd, 14);

  return {
    kind: "tds_deposit",
    dueOn,
    label:
      month === 6
        ? "TDS deposit (June — same-day rule from the 29th)"
        : "TDS deposit",
    periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    periodStart,
    periodEnd,
  };
}

const MONTH_NAMES = [
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

/* -------------------------------------------------------------------------- */
/*  Quarterly withholding tax return (s.177, ITA 2023)                         */
/* -------------------------------------------------------------------------- */

/**
 * Quarterly, due on the 25th of the month after each fiscal quarter ends:
 * Jul–Sep → 25 Oct, Oct–Dec → 25 Jan, Jan–Mar → 25 Apr, Apr–Jun → 25 Jul.
 *
 * Note this is quarterly, NOT half-yearly. Half-yearly (31 Jan / 31 Jul) was
 * s.75A of the repealed ITO 1984 and still appears in stale guidance.
 */
export function withholdingReturnDeadlines(fiscalYear: number): Deadline[] {
  const quarters: Array<{
    quarter: 1 | 2 | 3 | 4;
    startYear: number;
    startMonth: number;
    endYear: number;
    endMonth: number;
    dueYear: number;
    dueMonth: number;
  }> = [
    {
      quarter: 1,
      startYear: fiscalYear,
      startMonth: 7,
      endYear: fiscalYear,
      endMonth: 9,
      dueYear: fiscalYear,
      dueMonth: 10,
    },
    {
      quarter: 2,
      startYear: fiscalYear,
      startMonth: 10,
      endYear: fiscalYear,
      endMonth: 12,
      dueYear: fiscalYear + 1,
      dueMonth: 1,
    },
    {
      quarter: 3,
      startYear: fiscalYear + 1,
      startMonth: 1,
      endYear: fiscalYear + 1,
      endMonth: 3,
      dueYear: fiscalYear + 1,
      dueMonth: 4,
    },
    {
      quarter: 4,
      startYear: fiscalYear + 1,
      startMonth: 4,
      endYear: fiscalYear + 1,
      endMonth: 6,
      dueYear: fiscalYear + 1,
      dueMonth: 7,
    },
  ];

  const yearLabel = `FY ${fiscalYear}-${String(fiscalYear + 1).slice(-2)}`;

  return quarters.map((q) => ({
    kind: "withholding_return" as const,
    dueOn: isoDate(q.dueYear, q.dueMonth, 25),
    label: `Withholding tax return Q${q.quarter}`,
    periodLabel: `Q${q.quarter} ${yearLabel}`,
    periodStart: isoDate(q.startYear, q.startMonth, 1),
    periodEnd: lastDayOfMonth(q.endYear, q.endMonth),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Corporate tax                                                              */
/* -------------------------------------------------------------------------- */

/** Advance tax instalments: 15 Sep, 15 Dec, 15 Mar, 15 Jun. */
export function advanceTaxDeadlines(fiscalYear: number): Deadline[] {
  const yearLabel = `FY ${fiscalYear}-${String(fiscalYear + 1).slice(-2)}`;
  const instalments: Array<[1 | 2 | 3 | 4, number, number]> = [
    [1, fiscalYear, 9],
    [2, fiscalYear, 12],
    [3, fiscalYear + 1, 3],
    [4, fiscalYear + 1, 6],
  ];

  return instalments.map(([instalment, year, month]) => ({
    kind: "advance_tax" as const,
    dueOn: isoDate(year, month, 15),
    label: `Advance tax instalment ${instalment}`,
    periodLabel: `${instalment} of 4 · ${yearLabel}`,
    periodStart: isoDate(fiscalYear, 7, 1),
    periodEnd: lastDayOfMonth(fiscalYear + 1, 6),
  }));
}

/**
 * "Tax Day" for the company return: the 15th day of the 9th month after the
 * income year ends — 15 March for a 30 June year end.
 *
 * Two caveats, both of which argue for treating this as a default rather than
 * a fact:
 *   - Sources disagree. PwC says "ninth month" but parenthesises "September 15";
 *     other guidance corroborates March. Verify against the gazetted Act before
 *     relying on it for an actual filing.
 *   - NBR routinely extends Tax Day by order.
 *
 * The app should let the user override the stored due date.
 */
export function incomeTaxReturnDeadline(fiscalYear: number): Deadline {
  const yearEndMonth = 6;
  const yearEndYear = fiscalYear + 1;
  const dueMonthRaw = yearEndMonth + 9;
  const dueYear = yearEndYear + Math.floor((dueMonthRaw - 1) / 12);
  const dueMonth = ((dueMonthRaw - 1) % 12) + 1;

  return {
    kind: "income_tax_return",
    dueOn: isoDate(dueYear, dueMonth, 15),
    label: "Company income tax return (Tax Day)",
    periodLabel: `AY ${yearEndYear}-${String(yearEndYear + 1).slice(-2)}`,
    periodStart: isoDate(fiscalYear, 7, 1),
    periodEnd: lastDayOfMonth(yearEndYear, yearEndMonth),
  };
}

/* -------------------------------------------------------------------------- */

/** Every statutory deadline in a BD income year, in date order. */
export function deadlinesForFiscalYear(fiscalYear: number): Deadline[] {
  const monthly: Deadline[] = [];
  for (let i = 0; i < 12; i++) {
    const raw = 7 + i;
    const year = fiscalYear + Math.floor((raw - 1) / 12);
    const month = ((raw - 1) % 12) + 1;
    monthly.push(tdsDepositDeadlineForMonth(year, month));
  }

  return [
    ...monthly,
    ...withholdingReturnDeadlines(fiscalYear),
    ...advanceTaxDeadlines(fiscalYear),
    incomeTaxReturnDeadline(fiscalYear),
  ].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}

export type DeadlineStatus = "overdue" | "due_soon" | "upcoming";

export function deadlineStatus(
  deadline: Deadline,
  warnWithinDays = 7,
  today: IsoDate = todayInDhaka(),
): DeadlineStatus {
  if (deadline.dueOn < today) return "overdue";
  if (deadline.dueOn <= addDays(today, warnWithinDays)) return "due_soon";
  return "upcoming";
}
