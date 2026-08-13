import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  advanceTaxDeadlines,
  deadlineStatus,
  deadlinesForFiscalYear,
  incomeTaxReturnDeadline,
  tdsDepositDeadlineForMonth,
  tdsDepositDueDate,
  withholdingReturnDeadlines,
} from "./deadlines.ts";

describe("tdsDepositDueDate — normal months", () => {
  it("is two weeks after month end", () => {
    // July 2026 ends on the 31st; +14 days = 14 August.
    assert.equal(tdsDepositDueDate("2026-07-05"), "2026-08-14");
    assert.equal(tdsDepositDueDate("2026-07-31"), "2026-08-14");
  });

  it("uses the month of deduction, not the day", () => {
    assert.equal(tdsDepositDueDate("2026-08-01"), "2026-09-14");
    assert.equal(tdsDepositDueDate("2026-08-31"), "2026-09-14");
  });

  it("handles February in a non-leap year", () => {
    // Feb 2027 ends on the 28th; +14 = 14 March.
    assert.equal(tdsDepositDueDate("2027-02-10"), "2027-03-14");
  });

  it("handles February in a leap year", () => {
    // Feb 2028 ends on the 29th; +14 = 14 March.
    assert.equal(tdsDepositDueDate("2028-02-10"), "2028-03-14");
  });

  it("rolls into the next calendar year from December", () => {
    assert.equal(tdsDepositDueDate("2026-12-15"), "2027-01-14");
  });
});

describe("tdsDepositDueDate — the June cliff", () => {
  it("gives 7 days for deductions on 1–20 June", () => {
    assert.equal(tdsDepositDueDate("2027-06-01"), "2027-06-08");
    assert.equal(tdsDepositDueDate("2027-06-20"), "2027-06-27");
  });

  it("gives the next day for deductions on 21–28 June", () => {
    assert.equal(tdsDepositDueDate("2027-06-21"), "2027-06-22");
    assert.equal(tdsDepositDueDate("2027-06-28"), "2027-06-29");
  });

  it("requires same-day deposit on 29–30 June", () => {
    assert.equal(tdsDepositDueDate("2027-06-29"), "2027-06-29");
    assert.equal(tdsDepositDueDate("2027-06-30"), "2027-06-30");
  });

  it("switches rule exactly at the 20/21 and 28/29 boundaries", () => {
    // 20 June → +7; 21 June → +1. The one-day step is the whole point.
    assert.equal(tdsDepositDueDate("2026-06-20"), "2026-06-27");
    assert.equal(tdsDepositDueDate("2026-06-21"), "2026-06-22");
    assert.equal(tdsDepositDueDate("2026-06-28"), "2026-06-29");
    assert.equal(tdsDepositDueDate("2026-06-29"), "2026-06-29");
  });

  it("never spills into July", () => {
    for (const day of [21, 22, 25, 28, 29, 30]) {
      const date = `2026-06-${String(day).padStart(2, "0")}`;
      assert.ok(
        tdsDepositDueDate(date) <= "2026-06-30",
        `${date} should stay inside June`,
      );
    }
  });
});

describe("tdsDepositDeadlineForMonth", () => {
  it("is month end + 14 for a normal month", () => {
    const d = tdsDepositDeadlineForMonth(2026, 7);
    assert.equal(d.dueOn, "2026-08-14");
    assert.equal(d.periodLabel, "July 2026");
    assert.equal(d.periodStart, "2026-07-01");
    assert.equal(d.periodEnd, "2026-07-31");
  });

  it("uses the last day of June for June, not mid-July", () => {
    const d = tdsDepositDeadlineForMonth(2027, 6);
    assert.equal(d.dueOn, "2027-06-30");
    assert.match(d.label, /same-day/);
  });
});

describe("withholdingReturnDeadlines — quarterly, not half-yearly", () => {
  const deadlines = withholdingReturnDeadlines(2026);

  it("returns four quarters", () => {
    assert.equal(deadlines.length, 4);
  });

  it("falls due on the 25th of Oct, Jan, Apr, Jul", () => {
    assert.deepEqual(
      deadlines.map((d) => d.dueOn),
      ["2026-10-25", "2027-01-25", "2027-04-25", "2027-07-25"],
    );
  });

  it("covers the right statutory periods", () => {
    assert.equal(deadlines[0].periodStart, "2026-07-01");
    assert.equal(deadlines[0].periodEnd, "2026-09-30");
    assert.equal(deadlines[3].periodStart, "2027-04-01");
    assert.equal(deadlines[3].periodEnd, "2027-06-30");
  });

  it("does not use the repealed half-yearly dates", () => {
    const dates = deadlines.map((d) => d.dueOn);
    assert.ok(!dates.includes("2027-01-31"));
    assert.ok(!dates.includes("2027-07-31"));
  });
});

describe("advanceTaxDeadlines", () => {
  it("falls due on the 15th of Sep, Dec, Mar, Jun", () => {
    assert.deepEqual(
      advanceTaxDeadlines(2026).map((d) => d.dueOn),
      ["2026-09-15", "2026-12-15", "2027-03-15", "2027-06-15"],
    );
  });
});

describe("incomeTaxReturnDeadline", () => {
  it("is 15 March, nine months after the 30 June year end", () => {
    const d = incomeTaxReturnDeadline(2026);
    // FY2026 runs Jul 2026 – Jun 2027, so the ninth month after the year end
    // is March 2028 — not 2027, which would fall before the year even closed.
    assert.equal(d.dueOn, "2028-03-15");
    assert.equal(d.periodStart, "2026-07-01");
    assert.equal(d.periodEnd, "2027-06-30");
    assert.equal(d.periodLabel, "AY 2027-28");
  });

  it("always falls after the income year it reports on", () => {
    for (const fy of [2024, 2025, 2026, 2027]) {
      const d = incomeTaxReturnDeadline(fy);
      assert.ok(
        d.dueOn > d.periodEnd,
        `FY${fy}: due ${d.dueOn} must be after year end ${d.periodEnd}`,
      );
    }
  });
});

describe("deadlinesForFiscalYear", () => {
  const all = deadlinesForFiscalYear(2026);

  it("returns 12 monthly deposits + 4 returns + 4 advance + 1 annual", () => {
    assert.equal(all.length, 21);
  });

  it("is sorted by due date", () => {
    for (let i = 1; i < all.length; i++) {
      assert.ok(
        all[i - 1].dueOn <= all[i].dueOn,
        `out of order at ${i}: ${all[i - 1].dueOn} > ${all[i].dueOn}`,
      );
    }
  });

  it("covers every month of the income year", () => {
    const deposits = all.filter((d) => d.kind === "tds_deposit");
    assert.equal(deposits.length, 12);
    assert.equal(deposits[0].periodStart, "2026-07-01");
    assert.equal(deposits[11].periodStart, "2027-06-01");
  });
});

describe("deadlineStatus", () => {
  const deadline = tdsDepositDeadlineForMonth(2026, 7); // due 2026-08-14

  it("is overdue after the due date", () => {
    assert.equal(deadlineStatus(deadline, 7, "2026-08-15"), "overdue");
  });

  it("is due_soon inside the warning window", () => {
    assert.equal(deadlineStatus(deadline, 7, "2026-08-12"), "due_soon");
    // On the due date itself it is still due, not overdue.
    assert.equal(deadlineStatus(deadline, 7, "2026-08-14"), "due_soon");
  });

  it("is upcoming well before", () => {
    assert.equal(deadlineStatus(deadline, 7, "2026-08-01"), "upcoming");
  });
});
