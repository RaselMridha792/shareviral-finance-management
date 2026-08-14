import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  currentFiscalYear,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearRange,
  halfRange,
  monthIndexInFiscalYear,
  monthsInFiscalYear,
  periodIndexIssue,
  periodsPerFiscalYear,
  quarterOf,
  quarterRange,
} from "./periods.ts";

describe("fiscalYearOf", () => {
  it("puts July onward in the year that just started (BD mode)", () => {
    assert.equal(fiscalYearOf("2026-07-01", "bd_july_june"), 2026);
    assert.equal(fiscalYearOf("2026-08-12", "bd_july_june"), 2026);
    assert.equal(fiscalYearOf("2026-12-31", "bd_july_june"), 2026);
  });

  it("puts January–June in the year that started the previous July", () => {
    assert.equal(fiscalYearOf("2027-01-01", "bd_july_june"), 2026);
    assert.equal(fiscalYearOf("2027-06-30", "bd_july_june"), 2026);
    // One day later is a new fiscal year.
    assert.equal(fiscalYearOf("2027-07-01", "bd_july_june"), 2027);
  });

  it("is just the calendar year in calendar mode", () => {
    assert.equal(fiscalYearOf("2026-01-01", "calendar"), 2026);
    assert.equal(fiscalYearOf("2026-12-31", "calendar"), 2026);
  });
});

describe("fiscalYearRange", () => {
  it("spans 1 July to 30 June in BD mode", () => {
    const range = fiscalYearRange(2026, "bd_july_june");
    assert.equal(range.start, "2026-07-01");
    assert.equal(range.end, "2027-06-30");
    assert.equal(range.label, "FY 2026-27");
  });

  it("spans the calendar year in calendar mode", () => {
    const range = fiscalYearRange(2026, "calendar");
    assert.equal(range.start, "2026-01-01");
    assert.equal(range.end, "2026-12-31");
    assert.equal(range.label, "2026");
  });
});

describe("quarterRange (BD statutory quarters)", () => {
  it("Q1 is Jul–Sep", () => {
    const q = quarterRange(2026, 1, "bd_july_june");
    assert.equal(q.start, "2026-07-01");
    assert.equal(q.end, "2026-09-30");
  });

  it("Q2 is Oct–Dec", () => {
    const q = quarterRange(2026, 2, "bd_july_june");
    assert.equal(q.start, "2026-10-01");
    assert.equal(q.end, "2026-12-31");
  });

  it("Q3 is Jan–Mar of the following calendar year", () => {
    const q = quarterRange(2026, 3, "bd_july_june");
    assert.equal(q.start, "2027-01-01");
    assert.equal(q.end, "2027-03-31");
  });

  it("Q4 is Apr–Jun of the following calendar year", () => {
    const q = quarterRange(2026, 4, "bd_july_june");
    assert.equal(q.start, "2027-04-01");
    assert.equal(q.end, "2027-06-30");
  });

  it("uses calendar quarters in calendar mode", () => {
    const q1 = quarterRange(2026, 1, "calendar");
    assert.equal(q1.start, "2026-01-01");
    assert.equal(q1.end, "2026-03-31");
    const q4 = quarterRange(2026, 4, "calendar");
    assert.equal(q4.start, "2026-10-01");
    assert.equal(q4.end, "2026-12-31");
  });
});

describe("halfRange", () => {
  it("splits the BD year at 31 December", () => {
    const h1 = halfRange(2026, 1, "bd_july_june");
    assert.equal(h1.start, "2026-07-01");
    assert.equal(h1.end, "2026-12-31");
    const h2 = halfRange(2026, 2, "bd_july_june");
    assert.equal(h2.start, "2027-01-01");
    assert.equal(h2.end, "2027-06-30");
  });

  it("splits the calendar year at 30 June", () => {
    const h1 = halfRange(2026, 1, "calendar");
    assert.equal(h1.start, "2026-01-01");
    assert.equal(h1.end, "2026-06-30");
  });
});

describe("monthIndexInFiscalYear", () => {
  it("makes July the first month in BD mode", () => {
    assert.equal(monthIndexInFiscalYear(7, "bd_july_june"), 1);
    assert.equal(monthIndexInFiscalYear(12, "bd_july_june"), 6);
    assert.equal(monthIndexInFiscalYear(1, "bd_july_june"), 7);
    assert.equal(monthIndexInFiscalYear(6, "bd_july_june"), 12);
  });
});

describe("quarterOf", () => {
  it("maps August 2026 to Q1 of FY2026 in BD mode", () => {
    assert.deepEqual(quarterOf("2026-08-12", "bd_july_june"), {
      fiscalYear: 2026,
      quarter: 1,
    });
  });

  it("maps February 2027 to Q3 of FY2026", () => {
    assert.deepEqual(quarterOf("2027-02-15", "bd_july_june"), {
      fiscalYear: 2026,
      quarter: 3,
    });
  });
});

describe("monthsInFiscalYear", () => {
  it("returns 12 months starting at July in BD mode", () => {
    const months = monthsInFiscalYear(2026, "bd_july_june");
    assert.equal(months.length, 12);
    assert.equal(months[0].start, "2026-07-01");
    assert.equal(months[0].label, "July 2026");
    assert.equal(months[11].start, "2027-06-01");
    assert.equal(months[11].end, "2027-06-30");
  });

  it("handles February in a leap year", () => {
    // FY2027 runs Jul 2027 – Jun 2028; Feb 2028 has 29 days.
    const months = monthsInFiscalYear(2027, "bd_july_june");
    const february = months.find((m) => m.label === "February 2028");
    assert.ok(february);
    assert.equal(february.end, "2028-02-29");
  });
});

describe("fiscalYearLabel", () => {
  it("formats across a century boundary", () => {
    assert.equal(fiscalYearLabel(2099, "bd_july_june"), "FY 2099-00");
    assert.equal(fiscalYearLabel(2026, "calendar"), "2026");
  });
});

describe("currentFiscalYear", () => {
  it("accepts an explicit today for determinism", () => {
    assert.equal(currentFiscalYear("bd_july_june", "2026-08-12"), 2026);
    assert.equal(currentFiscalYear("bd_july_june", "2026-06-30"), 2025);
  });
});

describe("periodsPerFiscalYear", () => {
  it("knows how many of each size fit in a year", () => {
    assert.equal(periodsPerFiscalYear("month"), 12);
    assert.equal(periodsPerFiscalYear("quarter"), 4);
    assert.equal(periodsPerFiscalYear("half"), 2);
    assert.equal(periodsPerFiscalYear("year"), 1);
  });
});

/**
 * A report request used to be clamped rather than refused: asking for quarter 9
 * quietly answered with quarter 4. One `index` field serves four period sizes,
 * so its own max of 12 cannot catch it — this is the cross-field half.
 */
describe("periodIndexIssue", () => {
  it("allows every real period", () => {
    assert.equal(periodIndexIssue("month", 12), null);
    assert.equal(periodIndexIssue("quarter", 4), null);
    assert.equal(periodIndexIssue("half", 2), null);
    assert.equal(periodIndexIssue("year", 1), null);
  });

  it("refuses a quarter beyond the fourth", () => {
    assert.match(
      periodIndexIssue("quarter", 9) ?? "",
      /4 quarters — there is no quarter 9/,
    );
  });

  it("refuses a second half-year that does not exist", () => {
    assert.match(periodIndexIssue("half", 3) ?? "", /2 halves/);
  });

  it("refuses a thirteenth month", () => {
    assert.match(periodIndexIssue("month", 13) ?? "", /12 months/);
  });

  it("says something useful for the yearly period", () => {
    assert.match(periodIndexIssue("year", 2) ?? "", /must be 1/);
  });

  it("passes an absent index through — it defaults to the first", () => {
    assert.equal(periodIndexIssue("quarter", undefined), null);
  });
});
