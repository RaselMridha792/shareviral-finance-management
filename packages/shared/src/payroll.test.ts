import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  payslipBreakdownSchema,
  updatePayrollLineSchema,
  USUAL_DEDUCTIONS,
  USUAL_EARNINGS,
} from "./payroll.ts";

/**
 * The payslip's middle: the labelled lines it prints, and the "24 of 26" beside
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

describe("paid days on a payroll line", () => {
  it("takes 24 of 26", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      paidDays: 24,
      workingDays: 26,
    });
    assert.equal(parsed.success, true);
  });

  /**
   * The pair is what makes the figure readable. Either alone is allowed on the
   * way to typing the other — the payslip prints "Full month" until both are
   * there, rather than "24 of null".
   */
  it("takes one without the other", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ paidDays: 24 }).success,
      true,
    );
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 26 }).success,
      true,
    );
  });

  it("refuses more days paid than worked", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      paidDays: 27,
      workingDays: 26,
    });
    assert.equal(parsed.success, false);
    assert.equal(parsed.error?.issues[0]?.path[0], "paidDays");
  });

  it("takes zero paid days — somebody on unpaid leave all month", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ paidDays: 0, workingDays: 26 })
        .success,
      true,
    );
  });

  it("refuses a month with no working days at all", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 0 }).success,
      false,
    );
  });

  it("refuses more days than a month has", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ workingDays: 32 }).success,
      false,
    );
  });

  it("refuses a fraction of a day", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ paidDays: 23.5, workingDays: 26 })
        .success,
      false,
    );
  });

  /**
   * `null` clears the pair back to a full month. Distinct from omitting the
   * key, which leaves whatever is on the line — and the comparison must not
   * treat the cleared value as zero and start refusing it against a working
   * day count.
   */
  it("clears both with null", () => {
    const parsed = updatePayrollLineSchema.safeParse({
      paidDays: null,
      workingDays: null,
    });
    assert.equal(parsed.success, true);
  });

  it("clears one while the other stands", () => {
    assert.equal(
      updatePayrollLineSchema.safeParse({ paidDays: null, workingDays: 26 })
        .success,
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
