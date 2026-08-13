import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { monthlyEquivalent, nextRenewal } from "./subscriptions.ts";

describe("nextRenewal", () => {
  it("leaves a date that has not arrived alone", () => {
    assert.equal(nextRenewal("2026-09-03", "monthly", "2026-08-13"), "2026-09-03");
  });

  it("rolls a past anchor forward to the next one due", () => {
    assert.equal(nextRenewal("2026-08-03", "monthly", "2026-08-13"), "2026-09-03");
  });

  it("returns today when the renewal is today", () => {
    assert.equal(nextRenewal("2026-08-13", "monthly", "2026-08-13"), "2026-08-13");
  });

  it("catches up an anchor years old in one step, not month by month", () => {
    assert.equal(nextRenewal("2019-03-07", "monthly", "2026-08-13"), "2026-09-07");
    assert.equal(nextRenewal("2019-03-07", "yearly", "2026-08-13"), "2027-03-07");
    assert.equal(nextRenewal("2019-03-07", "quarterly", "2026-08-13"), "2026-09-07");
  });

  it("clamps the 31st into a short month rather than spilling into the next", () => {
    // Billed on the 31st: February must be the 28th, not the 3rd of March —
    // spilling would move the renewal a month early, every year.
    assert.equal(nextRenewal("2026-01-31", "monthly", "2026-02-01"), "2026-02-28");
    assert.equal(nextRenewal("2026-01-31", "monthly", "2026-04-01"), "2026-04-30");
  });

  it("handles a leap February", () => {
    assert.equal(nextRenewal("2028-01-31", "monthly", "2028-02-01"), "2028-02-29");
  });

  it("has nothing to say about something that does not recur", () => {
    assert.equal(nextRenewal("2026-08-03", "none", "2026-08-13"), null);
    assert.equal(nextRenewal(null, "monthly", "2026-08-13"), null);
    assert.equal(nextRenewal(undefined, "monthly", "2026-08-13"), null);
  });

  it("always lands on or after today, whatever the anchor", () => {
    const today = "2026-08-13";
    for (const anchor of [
      "2020-01-01",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2025-12-31",
      "2024-02-29",
    ]) {
      for (const cycle of ["monthly", "quarterly", "yearly"] as const) {
        const next = nextRenewal(anchor, cycle, today);
        assert.ok(next !== null, `${anchor} ${cycle} produced null`);
        assert.ok(
          next >= today,
          `${anchor} ${cycle} produced ${next}, which is before ${today}`,
        );
      }
    }
  });
});

describe("monthlyEquivalent", () => {
  it("puts a yearly and a monthly cost on the same scale", () => {
    assert.equal(monthlyEquivalent("1200.00", "yearly"), 100);
    assert.equal(monthlyEquivalent("300.00", "quarterly"), 100);
    assert.equal(monthlyEquivalent("100.00", "monthly"), 100);
  });

  it("is zero for anything that does not recur", () => {
    assert.equal(monthlyEquivalent("500.00", "none"), 0);
    assert.equal(monthlyEquivalent(null, "monthly"), 0);
    assert.equal(monthlyEquivalent("", "monthly"), 0);
    assert.equal(monthlyEquivalent("not a number", "monthly"), 0);
  });
});
