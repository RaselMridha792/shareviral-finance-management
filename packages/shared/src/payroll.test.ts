import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  payslipBreakdownSchema,
  updatePayrollLineSchema,
  USUAL_DEDUCTIONS,
  USUAL_EARNINGS,
} from "./payroll.ts";

/**
 * The payslip's middle: the labelled lines it prints, and the working-day
 * count beside
 * them. What these tests guard is the boundary — the API takes whatever the
 * drawer sends, and the drawer is a form somebody types into.
 */

const line = { label: "Basic Salary", amount: "36000.00" };

describe("a payslip breakdown", () => {
  it("takes a list of labelled amounts", () => {
    const parsed = payslipBreakdownSchema.safeParse([
      line,
      { label: "House Rent Allowance", amount: "18000.00" },
    ]);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.length, 2);
  });

  it("takes an empty list — a person with no split recorded", () => {
    assert.equal(payslipBreakdownSchema.safeParse([]).success, true);
  });

  it("refuses a line with no label, which would print as a bare figure", () => {
    assert.equal(
      payslipBreakdownSchema.safeParse([{ label: "  ", amount: "1.00" }])
        .success,
      false,
    );
  });

  it("refuses an amount that is not money", () => {
    for (const amount of ["", "abc", "1.234", "1,000.00"]) {
      assert.equal(
        payslipBreakdownSchema.safeParse([{ label: "Basic", amount }]).success,
        false,
        `${amount} should not be accepted`,
      );
    }
  });

  it("refuses a key nobody defined", () => {
    assert.equal(
      payslipBreakdownSchema.safeParse([{ ...line, taxable: true }]).success,
      false,
    );
  });

  it("stops at twenty lines", () => {
    const twenty = Array.from({ length: 20 }, () => line);
    assert.equal(payslipBreakdownSchema.safeParse(twenty).success, true);
    assert.equal(
      payslipBreakdownSchema.safeParse([...twenty, line]).success,
      false,
    );
  });

  it("is what the 'usual lines' button fills in", () => {
    for (const usual of [USUAL_EARNINGS, USUAL_DEDUCTIONS]) {
      const rows = usual.map((label) => ({ label, amount: "0.00" }));
      assert.equal(
        payslipBreakdownSchema.safeParse(rows).success,
        true,
        `${usual.join(", ")} must be acceptable as typed`,
      );
    }
  });
});

describe("working days on a payroll line", () => {
  /*
   * One number now, on the owner's rule. Paid days is gone from the contract
   * — the pair printed things like "14 of 14" that meant nothing — and the
   * API measures the number against the month's own calendar length, which
   * this schema cannot know. What it CAN hold is the shape: a whole day,
   * at least one, never more than the longest month, and null to put the
   * full month back.
   */
  it("takes a day count", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 10 }).success,
      true,
    );
  });

  it("refuses paidDays outright — the field is gone", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ paidDays: 24, workingDays: 26 })
        .success,
      false,
    );
  });

  it("refuses a month with no working days at all", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 0 }).success,
      false,
    );
  });

  it("refuses more days than the longest month has", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 32 }).success,
      false,
    );
  });

  it("refuses a fraction of a day", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 23.5 }).success,
      false,
    );
  });

  it("clears back to a full month with null", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: null }).success,
      true,
    );
  });
});

describe("clearing a breakdown", () => {
  it("null means the payslip prints one figure again", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      earningsBreakdown: null,
      deductionsBreakdown: null,
    });
    assert.equal(parsed.success, true);
  });

  it("a breakdown alone is a valid change", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      earningsBreakdown: [line],
    });
    assert.equal(parsed.success, true);
  });

  it("still refuses a patch that changes nothing", () => {
    assert.equal(updatePayrollLineSchema.safeParse({}).success, false);
  });

  /**
   * The breakdown describes the gross; it does not have to add up to it. A
   * mid-month raise legitimately produces a split that does not sum to the
   * month's figure, and refusing would make the app unusable in exactly the
   * month somebody needs it. The drawer says so on screen instead.
   */
  it("does not require the lines to sum to anything", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      grossAmount: "65500.00",
      earningsBreakdown: [{ label: "Basic Salary", amount: "1.00" }],
    });
    assert.equal(parsed.success, true);
  });
});
