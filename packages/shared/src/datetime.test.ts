import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  addMonths,
  compareIsoDates,
  daysBetween,
  daysInMonth,
  firstDayOfMonth,
  isAfter,
  isBefore,
  isoDate,
  lastDayOfMonth,
  parseIsoDate,
  todayInDhaka,
} from "./datetime.ts";

/**
 * These tests exist because of one specific failure: a server running UTC is six
 * hours behind Dhaka, so an entry made at 3 a.m. on 1 August lands in July's
 * report. Every case below is written as an absolute instant (`Z`), so the
 * result does not depend on the machine running the test.
 */
describe("todayInDhaka", () => {
  it("calls 3 a.m. on 1 August in Dhaka August, not July", () => {
    // 21:00 UTC on 31 July is 03:00 on 1 August in Dhaka.
    assert.equal(todayInDhaka(new Date("2026-07-31T21:00:00Z")), "2026-08-01");
  });

  it("holds the old month right up to Dhaka midnight", () => {
    assert.equal(todayInDhaka(new Date("2026-07-31T17:59:59Z")), "2026-07-31");
  });

  it("turns the month over at Dhaka midnight, not UTC midnight", () => {
    assert.equal(todayInDhaka(new Date("2026-07-31T18:00:00Z")), "2026-08-01");
  });

  it("rolls the fiscal year over on the same rule", () => {
    // The BD income year starts 1 July; getting this wrong misfiles a year.
    assert.equal(todayInDhaka(new Date("2026-06-30T18:00:00Z")), "2026-07-01");
  });

  it("rolls the calendar year over on the same rule", () => {
    assert.equal(todayInDhaka(new Date("2026-12-31T18:30:00Z")), "2027-01-01");
  });

  it("does not shift a mid-afternoon Dhaka instant", () => {
    assert.equal(todayInDhaka(new Date("2026-08-14T09:00:00Z")), "2026-08-14");
  });

  it("never observes daylight saving — Dhaka has none", () => {
    // Same wall clock in January and July; a DST-aware zone would differ.
    assert.equal(todayInDhaka(new Date("2026-01-15T18:30:00Z")), "2026-01-16");
    assert.equal(todayInDhaka(new Date("2026-07-15T18:30:00Z")), "2026-07-16");
  });
});

describe("isoDate", () => {
  it("pads month and day", () => {
    assert.equal(isoDate(2026, 7, 1), "2026-07-01");
  });

  it("builds from parts with no timezone involved", () => {
    // A Date-based implementation would shift this one back a day on a
    // negative-offset machine.
    assert.equal(isoDate(2026, 1, 1), "2026-01-01");
  });
});

describe("parseIsoDate", () => {
  it("splits a date into parts", () => {
    assert.deepEqual(parseIsoDate("2026-08-14"), {
      year: 2026,
      month: 8,
      day: 14,
    });
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    assert.throws(() => parseIsoDate("14/08/2026"), /Not an ISO date/);
    assert.throws(() => parseIsoDate("2026-8-14"), /Not an ISO date/);
    assert.throws(() => parseIsoDate(""), /Not an ISO date/);
  });
});

describe("daysInMonth", () => {
  it("knows February in a common year", () => {
    assert.equal(daysInMonth(2027, 2), 28);
  });

  it("knows February in a leap year", () => {
    assert.equal(daysInMonth(2028, 2), 29);
  });

  it("knows the century rule", () => {
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
  });

  it("handles the 30-day months", () => {
    assert.equal(daysInMonth(2026, 6), 30);
    assert.equal(daysInMonth(2026, 12), 31);
  });
});

describe("month edges", () => {
  it("finds the last day of a 31-day month", () => {
    assert.equal(lastDayOfMonth(2026, 7), "2026-07-31");
  });

  it("finds the last day of June — the BD year end", () => {
    assert.equal(lastDayOfMonth(2026, 6), "2026-06-30");
  });

  it("finds the last day of a leap February", () => {
    assert.equal(lastDayOfMonth(2028, 2), "2028-02-29");
  });

  it("finds the first day", () => {
    assert.equal(firstDayOfMonth(2026, 12), "2026-12-01");
  });
});

describe("addDays", () => {
  it("crosses a month end", () => {
    assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  });

  it("crosses a year end", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  it("goes backwards", () => {
    assert.equal(addDays("2026-08-01", -1), "2026-07-31");
  });

  it("counts a leap day", () => {
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  });

  it("adds the TDS deposit fortnight without drifting", () => {
    // "Within two weeks of month end" — the deadline engine leans on this.
    assert.equal(addDays("2026-07-31", 14), "2026-08-14");
  });

  it("returns the same date for zero", () => {
    assert.equal(addDays("2026-08-14", 0), "2026-08-14");
  });
});

describe("addMonths", () => {
  it("clamps rather than spilling into the next month", () => {
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  });

  it("clamps to a leap February", () => {
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  });

  it("crosses a year end", () => {
    assert.equal(addMonths("2026-11-30", 2), "2027-01-30");
  });

  it("goes backwards across a year start", () => {
    assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
  });

  it("goes back a whole year", () => {
    assert.equal(addMonths("2026-07-01", -12), "2025-07-01");
  });

  it("reaches Tax Day — nine months after a 30 June year end", () => {
    assert.equal(addMonths("2026-06-30", 9), "2027-03-30");
  });
});

describe("comparison", () => {
  it("orders two dates", () => {
    assert.equal(compareIsoDates("2026-07-31", "2026-08-01"), -1);
    assert.equal(compareIsoDates("2026-08-01", "2026-07-31"), 1);
    assert.equal(compareIsoDates("2026-08-01", "2026-08-01"), 0);
  });

  it("compares by calendar order, not string length or number value", () => {
    assert.equal(isBefore("2026-09-01", "2026-10-01"), true);
    assert.equal(isAfter("2026-10-01", "2026-09-01"), true);
  });

  it("is exclusive at the boundary", () => {
    assert.equal(isBefore("2026-08-14", "2026-08-14"), false);
    assert.equal(isAfter("2026-08-14", "2026-08-14"), false);
  });
});

describe("daysBetween", () => {
  it("counts forward", () => {
    assert.equal(daysBetween("2026-07-31", "2026-08-14"), 14);
  });

  it("counts backward as a negative", () => {
    assert.equal(daysBetween("2026-08-14", "2026-07-31"), -14);
  });

  it("is zero for the same day", () => {
    assert.equal(daysBetween("2026-08-14", "2026-08-14"), 0);
  });

  it("counts a whole leap year", () => {
    assert.equal(daysBetween("2028-01-01", "2029-01-01"), 366);
  });

  it("counts a whole common year", () => {
    assert.equal(daysBetween("2026-01-01", "2027-01-01"), 365);
  });

  it("spans a BD income year", () => {
    assert.equal(daysBetween("2026-07-01", "2027-06-30"), 364);
  });
});
