import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromMinorUnits, toMinorUnits } from "./money.ts";
import {
  DEFAULT_TDS_POLICY,
  calculateTds,
  monthlyTdsFor,
  proRataTds,
  saveTdsPolicySchema,
  tdsBasisSchema,
  tdsPolicySchema,
  type TdsPolicy,
} from "./tds.ts";

/**
 * The advisor's own twelve, done by hand, as fixtures.
 *
 * These are the reason it is defensible for this app to compute tax at all,
 * having recorded early on that it would not. Eleven agree with this code
 * exactly. The twelfth does not, and that case is asserted too — with the
 * handwritten figure *and* the correct one — because the difference is the
 * whole argument.
 *
 * The policy under test is the advisor's, except for the exemption cap: the
 * handwriting uses 4,50,000 and the owner has chosen 4,00,000. Only one of the
 * twelve earns enough for the cap to bind, so it is exercised separately
 * rather than being allowed to make eleven fixtures ambiguous.
 */

/** As the handwriting works, so the eleven can be compared to it directly. */
const ADVISOR: TdsPolicy = {
  ...DEFAULT_TDS_POLICY,
  exemptionCap: "450000.00",
};

const annual = (monthly: number) => (monthly * 12).toFixed(2);

describe("TDS, against the advisor's twelve handwritten calculations", () => {
  const cases: Array<{
    name: string;
    monthly: number;
    taxable: string;
    beforeRebate: string;
    net: string;
    monthlyTds: string;
  }> = [
    // Under the first band: no tax, and no minimum tax either.
    {
      name: "Omare Ahamed Sakib",
      monthly: 45000,
      taxable: "360000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "Khairul Bashar",
      monthly: 37000,
      taxable: "296000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "Amir Faysal",
      monthly: 30000,
      taxable: "240000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "Shahriar Hossain",
      monthly: 42000,
      taxable: "336000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "Sagar Biswas",
      monthly: 46000,
      taxable: "368000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "Rukiya Islam Tazin",
      monthly: 40000,
      taxable: "320000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },
    {
      name: "SM Showkot Hasan",
      monthly: 43000,
      taxable: "344000.00",
      beforeRebate: "0.00",
      net: "0.00",
      monthlyTds: "0.00",
    },

    // Over the threshold, but the rebate wipes the liability out — so the
    // floor lifts them back to 5,000.
    {
      name: "Ibne Saleheen",
      monthly: 67000,
      taxable: "536000.00",
      beforeRebate: "13600.00",
      net: "5000.00",
      monthlyTds: "416.00",
    },
    {
      name: "(unnamed, 62k)",
      monthly: 62000,
      taxable: "496000.00",
      beforeRebate: "9600.00",
      net: "5000.00",
      monthlyTds: "416.00",
    },

    // Ordinary taxpayers.
    {
      name: "MD. Yeasin Hossain",
      monthly: 100000,
      taxable: "800000.00",
      beforeRebate: "45000.00",
      net: "21000.00",
      monthlyTds: "1750.00",
    },
    {
      name: "Emon Reja",
      monthly: 200000,
      taxable: "1950000.00",
      beforeRebate: "277500.00",
      net: "219000.00",
      monthlyTds: "18250.00",
    },
  ];

  for (const c of cases) {
    it(`matches ${c.name}`, () => {
      const r = calculateTds(annual(c.monthly), ADVISOR);
      assert.equal(r.taxableIncome, c.taxable, "taxable income");
      assert.equal(r.taxBeforeRebate, c.beforeRebate, "tax before rebate");
      assert.equal(r.netAnnualTax, c.net, "net annual tax");
      assert.equal(r.monthlyTds, c.monthlyTds, "monthly TDS");
    });
  }

  /**
   * The twelfth.
   *
   * Taxable income is 7,20,000, so 3,20,000 sits above the zero band. The
   * handwriting put all of it at 10% and got 32,000. The slab table puts
   * 3,00,000 at 10% and the last 20,000 at 15%, which is 33,000.
   *
   * It is the only one of the twelve where the second band overflows and the
   * split was missed — Yeasin and Emon overflow too and both were done
   * correctly — so this is a slip of the pen rather than a different rule, and
   * the code is right to disagree.
   */
  it("disagrees with Mirza Showvik, and is right to", () => {
    const r = calculateTds(annual(90000), ADVISOR);

    assert.equal(r.taxableIncome, "720000.00");
    assert.equal(r.taxBeforeRebate, "33000.00", "the slabs give 33,000");
    assert.notEqual(
      r.taxBeforeRebate,
      "32000.00",
      "the handwriting says 32,000",
    );

    // Everything else on that page agrees, which is what makes it a slip
    // rather than a disagreement about the rule.
    assert.equal(r.rebate.onTaxableIncome, "21600.00");
    assert.equal(r.rebate.onInvestment, "27000.00");
    assert.equal(r.rebate.applied, "21600.00");

    assert.equal(r.netAnnualTax, "11400.00");
    assert.equal(r.monthlyTds, "950.00", "not the 867 on the page");
  });
});

describe("the exemption cap", () => {
  it("binds only when a third of salary exceeds it", () => {
    // Emon is the only one of the twelve earning enough for this to matter.
    const atFourFifty = calculateTds(annual(200000), ADVISOR);
    const atFour = calculateTds(annual(200000), DEFAULT_TDS_POLICY);

    assert.equal(atFourFifty.exemption.applied, "450000.00");
    assert.equal(atFour.exemption.applied, "400000.00");
    assert.equal(atFourFifty.taxableIncome, "1950000.00");
    assert.equal(atFour.taxableIncome, "2000000.00");
  });

  it("leaves everybody else untouched, because a third is already lower", () => {
    for (const monthly of [45000, 37000, 30000, 67000, 90000]) {
      const a = calculateTds(annual(monthly), ADVISOR);
      const b = calculateTds(annual(monthly), DEFAULT_TDS_POLICY);
      assert.equal(a.taxableIncome, b.taxableIncome);
    }
  });
});

describe("the rebate, as a bracket", () => {
  it("takes the lowest of the three limbs", () => {
    const r = calculateTds("800000.00", DEFAULT_TDS_POLICY);
    // 8,00,000 salary. A third of it is 2,66,666.66 in whole paisa — under the
    // 4,00,000 cap, so the fraction is what applies and the taxable figure
    // carries the remainder rather than a rounded third.
    assert.equal(r.exemption.byFraction, "266666.66");
    assert.equal(r.exemption.applied, "266666.66");
    assert.equal(r.taxableIncome, "533333.34");

    assert.equal(r.rebate.eligibleInvestment, "133333.33", "25% of taxable");
    assert.equal(r.rebate.onInvestment, "19999.99", "15% of that");
    assert.equal(r.rebate.onTaxableIncome, "16000.00", "3% of taxable");
    assert.equal(r.rebate.fixedCap, "1000000.00");
    assert.equal(r.rebate.applied, "16000.00", "the lowest of the three");
  });

  it("moves when the bracket rates move — which is why it is not collapsed", () => {
    // The whole reason the two multiplications stay two: change one rate and
    // the figure has to follow. A hard-coded 3.75% would not.
    const generous: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: {
        ...DEFAULT_TDS_POLICY.rebate,
        investmentRate: 0.5,
        taxableShareCap: 1,
      },
    };
    const r = calculateTds(annual(100000), generous);
    assert.equal(r.taxableIncome, "800000.00");
    assert.equal(r.rebate.eligibleInvestment, "400000.00", "half of taxable");
    assert.equal(r.rebate.onInvestment, "60000.00", "15% of that");
  });

  it("grants nothing when the assumption is switched off and nothing is declared", () => {
    // This is the switch the owner asked for. On, everybody gets the rebate;
    // off, only somebody who actually declares an investment does.
    const strict: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: { ...DEFAULT_TDS_POLICY.rebate, assumeFullInvestment: false },
    };
    const r = calculateTds(annual(100000), strict);
    assert.equal(r.rebate.eligibleInvestment, "0.00");
    assert.equal(r.rebate.applied, "0.00");
    assert.equal(r.netAnnualTax, "45000.00", "the full tax, with no rebate");
  });

  it("uses a declared investment when the assumption is off", () => {
    const strict: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: { ...DEFAULT_TDS_POLICY.rebate, assumeFullInvestment: false },
    };
    const r = calculateTds(annual(100000), strict, "100000.00");
    assert.equal(r.rebate.onInvestment, "15000.00", "15% of what was declared");
    assert.equal(r.rebate.applied, "15000.00", "still below 3% of taxable");
    assert.equal(r.netAnnualTax, "30000.00");
  });
});

describe("the minimum tax", () => {
  it("lifts a taxpayer whose rebate wiped the liability out", () => {
    const r = calculateTds(annual(67000), DEFAULT_TDS_POLICY);
    assert.equal(r.taxAfterRebate, "0.00");
    assert.equal(r.minimumTaxApplied, "5000.00");
    assert.equal(r.netAnnualTax, "5000.00");
  });

  it("does not touch somebody below the first band", () => {
    // Seven of the advisor's twelve are here, and every one shows zero.
    const r = calculateTds(annual(45000), DEFAULT_TDS_POLICY);
    assert.equal(r.taxableIncome, "360000.00");
    assert.equal(r.minimumTaxApplied, null);
    assert.equal(r.netAnnualTax, "0.00");
  });

  it("can be switched off", () => {
    const off: TdsPolicy = { ...DEFAULT_TDS_POLICY, minimumTaxEnabled: false };
    const r = calculateTds(annual(67000), off);
    assert.equal(r.minimumTaxApplied, null);
    assert.equal(r.netAnnualTax, "0.00");
  });
});

describe("the slab table", () => {
  it("shows every band that applied, with what fell in it", () => {
    const r = calculateTds(annual(200000), ADVISOR);
    assert.deepEqual(
      r.bands.map((b) => [b.amount, b.rate, b.tax]),
      [
        ["400000.00", 0, "0.00"],
        ["300000.00", 0.1, "30000.00"],
        ["400000.00", 0.15, "60000.00"],
        ["500000.00", 0.2, "100000.00"],
        ["350000.00", 0.25, "87500.00"],
      ],
    );
  });

  it("stops at the band the income reaches, rather than listing empty ones", () => {
    const r = calculateTds(annual(45000), DEFAULT_TDS_POLICY);
    assert.equal(r.bands.length, 1);
    assert.equal(r.bands[0].amount, "360000.00");
  });

  it("puts everything left in the last band, which has no width", () => {
    const r = calculateTds("50000000.00", DEFAULT_TDS_POLICY);
    const last = r.bands[r.bands.length - 1];
    assert.equal(last.rate, 0.3);
    assert.equal(last.label, "Remainder");
    // 5 crore salary, 4,00,000 exempt → 4,96,00,000 taxable, of which
    // 36,00,000 is covered by the earlier bands.
    assert.equal(last.amount, "46000000.00");
  });
});

describe("proRataTds", () => {
  it("divides by thirty, as the advisor does", () => {
    // Emon's page: 18,250 a month, 18 days worked, 10,950.
    assert.equal(proRataTds("18250.00", 18), "10950.00");
  });

  it("gives a whole month for thirty days", () => {
    assert.equal(proRataTds("18250.00", 30), "18250.00");
  });

  it("does not use the calendar, so February pays the same daily rate", () => {
    assert.equal(proRataTds("3000.00", 28), proRataTds("3000.00", 28, 30));
    assert.notEqual(
      proRataTds("3000.00", 28, 28),
      proRataTds("3000.00", 28, 30),
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  Gaps an adversarial review found, and what closes them                     */
/* -------------------------------------------------------------------------- */

/**
 * Five agents were pointed at this file and the engine beside it, and a sixth
 * tried to refute whatever they found. The tests below are the findings that
 * survived. Each is here rather than in a note, because "somebody checked
 * once" is not a property of code.
 */

describe("the shape of a slab table", () => {
  /**
   * Three files said "the last band has no width" and not one of them enforced
   * it. Both tables below were accepted at every layer until the schema
   * learned the rule.
   */
  it("refuses a table with no open band, which would stop taxing at the top", () => {
    const closed = DEFAULT_TDS_POLICY.slabs.slice(0, 5);
    assert.equal(
      tdsPolicySchema.safeParse({ ...DEFAULT_TDS_POLICY, slabs: closed })
        .success,
      false,
    );

    // What it would have done: everything above the last finite band untaxed.
    const bad = { ...DEFAULT_TDS_POLICY, slabs: closed };
    assert.equal(calculateTds("6000000.00", bad).taxBeforeRebate, "690000.00");
    assert.equal(
      calculateTds("6000000.00", DEFAULT_TDS_POLICY).taxBeforeRebate,
      "1290000.00",
      "with the open band, the top of the income is taxed",
    );
  });

  it("refuses an open band anywhere but last, which would swallow everything", () => {
    const scrambled = [
      { width: null, rate: 0.3 },
      ...DEFAULT_TDS_POLICY.slabs.slice(0, 5),
    ];
    assert.equal(
      tdsPolicySchema.safeParse({ ...DEFAULT_TDS_POLICY, slabs: scrambled })
        .success,
      false,
    );

    // A 5,40,000 salary owes nothing under the real rule. Under that table the
    // whole taxable amount is taxed at 30%.
    const bad = { ...DEFAULT_TDS_POLICY, slabs: scrambled };
    assert.equal(calculateTds("540000.00", bad).taxBeforeRebate, "108000.00");
    assert.equal(
      calculateTds("540000.00", DEFAULT_TDS_POLICY).taxBeforeRebate,
      "0.00",
    );
  });

  it("refuses two open bands", () => {
    assert.equal(
      tdsPolicySchema.safeParse({
        ...DEFAULT_TDS_POLICY,
        slabs: [
          { width: null, rate: 0.1 },
          { width: null, rate: 0.3 },
        ],
      }).success,
      false,
    );
  });
});

describe("money on a policy", () => {
  /**
   * A negative cap made taxable income exceed the salary: 16,00,000 taxable on
   * a 12,00,000 wage, and a monthly deduction of 11,833 instead of 1,750.
   */
  it("refuses a negative exemption cap", () => {
    assert.equal(
      tdsPolicySchema.safeParse({
        ...DEFAULT_TDS_POLICY,
        exemptionCap: "-400000.00",
      }).success,
      false,
    );

    const bad = { ...DEFAULT_TDS_POLICY, exemptionCap: "-400000.00" };
    assert.equal(calculateTds("1200000.00", bad).taxableIncome, "1600000.00");
  });

  it("refuses a negative rebate ceiling, which would add to the tax", () => {
    assert.equal(
      tdsPolicySchema.safeParse({
        ...DEFAULT_TDS_POLICY,
        rebate: { ...DEFAULT_TDS_POLICY.rebate, fixedCap: "-1.00" },
      }).success,
      false,
    );
  });

  it("refuses a negative band width", () => {
    const slabs = [...DEFAULT_TDS_POLICY.slabs];
    slabs[1] = { ...slabs[1], width: "-300000.00" };
    assert.equal(
      tdsPolicySchema.safeParse({ ...DEFAULT_TDS_POLICY, slabs }).success,
      false,
    );
  });

  it("refuses a rate with more places than the column keeps", () => {
    // numeric(6,4) rounds 0.12345 to 0.1235 without complaint, so the screen
    // that saved it and the screen that reloads it show different rules.
    const slabs = [...DEFAULT_TDS_POLICY.slabs];
    slabs[1] = { ...slabs[1], rate: 0.12345 };
    assert.equal(
      tdsPolicySchema.safeParse({ ...DEFAULT_TDS_POLICY, slabs }).success,
      false,
    );
    slabs[1] = { ...slabs[1], rate: 0.1234 };
    assert.equal(
      tdsPolicySchema.safeParse({ ...DEFAULT_TDS_POLICY, slabs }).success,
      true,
    );
  });
});

describe("the default policy", () => {
  /**
   * Used everywhere and tested nowhere: mutating its fiscal year to 1999 left
   * the whole suite green.
   */
  it("satisfies its own schema", () => {
    const parsed = tdsPolicySchema.safeParse(DEFAULT_TDS_POLICY);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  });

  it("is the rule the worksheets describe, and the SQL seeds", () => {
    assert.equal(DEFAULT_TDS_POLICY.exemptionNumerator, 1);
    assert.equal(DEFAULT_TDS_POLICY.exemptionDenominator, 3);
    assert.equal(DEFAULT_TDS_POLICY.exemptionCap, "400000.00");
    assert.deepEqual(
      DEFAULT_TDS_POLICY.slabs.map((b) => [b.width, b.rate]),
      [
        ["400000.00", 0],
        ["300000.00", 0.1],
        ["400000.00", 0.15],
        ["500000.00", 0.2],
        ["2000000.00", 0.25],
        [null, 0.3],
      ],
      "the same six rows are seeded by deploy/sql/2026-08-19-tax-policy.sql",
    );
    assert.equal(DEFAULT_TDS_POLICY.minimumTax, "5000.00");
  });

  it("is what the save contract accepts, minus the year", () => {
    const { fiscalYear: _year, ...rest } = DEFAULT_TDS_POLICY;
    assert.equal(saveTdsPolicySchema.safeParse(rest).success, true);
  });
});

describe("the rebate limbs, each proved to bind", () => {
  /**
   * The ceiling was in the code and in no assertion. Deleting it from the
   * comparison left every test green, because no fixture earned enough for it
   * to be the lowest of the three.
   */
  it("the flat ceiling binds on a large enough income", () => {
    const r = calculateTds("60000000.00", DEFAULT_TDS_POLICY);
    assert.equal(r.rebate.fixedCap, "1000000.00");
    assert.equal(r.rebate.applied, "1000000.00", "the ceiling is the lowest");
    assert.ok(
      Number(r.rebate.onInvestment) > 1000000,
      "and the other two limbs are above it",
    );
    assert.ok(Number(r.rebate.onTaxableIncome) > 1000000);
  });

  it("the investment limb binds when the assumed rate is small", () => {
    const stingy: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: { ...DEFAULT_TDS_POLICY.rebate, investmentRate: 0.05 },
    };
    const r = calculateTds("1200000.00", stingy);
    assert.equal(r.rebate.onInvestment, "6000.00");
    assert.equal(r.rebate.onTaxableIncome, "24000.00");
    assert.equal(r.rebate.applied, "6000.00", "the investment limb is lowest");
  });

  it("the taxable-income limb binds under the shipped rates", () => {
    const r = calculateTds("1200000.00", DEFAULT_TDS_POLICY);
    assert.equal(r.rebate.onInvestment, "30000.00");
    assert.equal(r.rebate.applied, "24000.00", "3% of taxable is lowest");
  });
});

describe("the minimum-tax threshold", () => {
  /**
   * No fixture landed on it, so `>` and `>=` were interchangeable as far as
   * the suite could tell. Both sides are pinned now.
   */
  it("taxable exactly at the first band owes nothing", () => {
    const r = calculateTds("600000.00", DEFAULT_TDS_POLICY);
    assert.equal(r.taxableIncome, "400000.00");
    assert.equal(r.minimumTaxApplied, null);
    assert.equal(r.netAnnualTax, "0.00");
  });

  it("one paisa above it attaches the floor", () => {
    const r = calculateTds("600000.01", DEFAULT_TDS_POLICY);
    assert.equal(r.taxableIncome, "400000.01");
    assert.equal(r.taxBeforeRebate, "0.00");
    assert.equal(r.minimumTaxApplied, "5000.00");
  });
});

describe("what the arithmetic does with remainders", () => {
  /**
   * Not a defect, but not obvious either, and undocumented until a review
   * measured it.
   */
  it("twelve monthly deductions can fall a few taka short of the year", () => {
    const r = calculateTds("804000.00", DEFAULT_TDS_POLICY);
    assert.equal(r.netAnnualTax, "5000.00");
    /*
     * A WHOLE TAKA since the owner asked payroll to carry no paisa anywhere:
     * *"ami kono employee er salary te to eirokom decimal kono number
     * deinai"*. It used to read 416.66 and the shortfall was eight paisa a
     * year; it is now eight taka, which is the price of a payslip with no
     * paisa on it.
     *
     * FLOORED rather than rounded, deliberately. A deduction a taka light is
     * settled by the return; one a taka heavy has been taken from somebody's
     * pay without authority. The advisor's own page reads 417 flat, so this is
     * a taka under their figure rather than over it.
     */
    assert.equal(r.monthlyTds, "416.00");
    assert.equal((41600n * 12n).toString(), "499200");
  });

  it("band amounts add up to the taxable income", () => {
    for (const salary of [
      "540000.00",
      "1200000.00",
      "2400000.00",
      "60000000.00",
    ]) {
      const r = calculateTds(salary, DEFAULT_TDS_POLICY);
      const sum = r.bands.reduce(
        (total, b) => total + BigInt(b.amount.replace(".", "")),
        0n,
      );
      assert.equal(
        sum.toString(),
        r.taxableIncome.replace(".", ""),
        `the bands must account for all of ${salary}`,
      );
    }
  });

  it("band taxes add up to the tax before rebate", () => {
    for (const salary of ["1200000.00", "2400000.00", "60000000.00"]) {
      const r = calculateTds(salary, DEFAULT_TDS_POLICY);
      const sum = r.bands.reduce(
        (total, b) => total + BigInt(b.tax.replace(".", "")),
        0n,
      );
      assert.equal(sum.toString(), r.taxBeforeRebate.replace(".", ""));
    }
  });
});

describe("proRataTds guards", () => {
  it("returns nothing rather than dividing by zero", () => {
    assert.equal(proRataTds("18250.00", 10, 0), "0.00");
  });
});

/* -------------------------------------------------------------------------- */
/*  A month's deduction, and the working stored beside it                      */
/* -------------------------------------------------------------------------- */

describe("monthlyTdsFor", () => {
  /**
   * The projection is twelve times the month, not earnings to date. It is the
   * convention the company's own working uses, and the only one available in
   * January for somebody whose salary may change in April.
   */
  it("projects the year from the month", () => {
    const { annualSalary } = monthlyTdsFor("65500.00", DEFAULT_TDS_POLICY);
    assert.equal(annualSalary, "786000.00");
  });

  it("agrees with calculating the year directly", () => {
    for (const monthly of ["45000.00", "65500.00", "100000.00", "250000.00"]) {
      const viaMonth = monthlyTdsFor(monthly, DEFAULT_TDS_POLICY);
      const annual = fromMinorUnits(toMinorUnits(monthly) * 12n);
      assert.equal(
        viaMonth.monthlyTds,
        calculateTds(annual, DEFAULT_TDS_POLICY).monthlyTds,
        `${monthly} a month`,
      );
    }
  });

  it("deducts nothing from a salary under the threshold", () => {
    // 45,000 a month is 5,40,000 a year: a 1,80,000 exemption leaves 3,60,000,
    // which is inside the first band.
    const { monthlyTds, result } = monthlyTdsFor(
      "45000.00",
      DEFAULT_TDS_POLICY,
    );
    assert.equal(result.taxableIncome, "360000.00");
    assert.equal(monthlyTds, "0.00");
  });

  it("uses the declared investment only when the policy is not assuming", () => {
    const declaring: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: { ...DEFAULT_TDS_POLICY.rebate, assumeFullInvestment: false },
    };

    const nothingDeclared = monthlyTdsFor("100000.00", declaring, "0");
    const declared = monthlyTdsFor("100000.00", declaring, "200000.00");
    assert.equal(nothingDeclared.result.rebate.applied, "0.00");
    assert.ok(
      Number(declared.result.rebate.applied) > 0,
      "declaring an investment must reduce the tax",
    );
    assert.ok(Number(declared.monthlyTds) < Number(nothingDeclared.monthlyTds));

    // With the assumption on — the company's own choice — it is ignored.
    const assumed = monthlyTdsFor("100000.00", DEFAULT_TDS_POLICY, "0");
    const assumedDeclaring = monthlyTdsFor(
      "100000.00",
      DEFAULT_TDS_POLICY,
      "200000.00",
    );
    assert.equal(assumed.monthlyTds, assumedDeclaring.monthlyTds);
  });

  it("moves when the rule moves — which is the point of a stored basis", () => {
    const cheaper: TdsPolicy = {
      ...DEFAULT_TDS_POLICY,
      rebate: { ...DEFAULT_TDS_POLICY.rebate, rebateRate: 0.1 },
    };
    assert.notEqual(
      monthlyTdsFor("250000.00", DEFAULT_TDS_POLICY).monthlyTds,
      monthlyTdsFor("250000.00", cheaper).monthlyTds,
    );
  });
});

describe("the basis stored on a payroll line", () => {
  const basis = {
    fiscalYear: 2026,
    annualSalary: "786000.00",
    declaredInvestment: "0",
    exactYear: true,
    policy: DEFAULT_TDS_POLICY,
  };

  it("round-trips, so a payslip can be reopened and re-derived", () => {
    const parsed = tdsBasisSchema.safeParse(JSON.parse(JSON.stringify(basis)));
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    assert.equal(
      calculateTds(
        parsed.data.annualSalary,
        parsed.data.policy,
        parsed.data.declaredInvestment,
      ).monthlyTds,
      monthlyTdsFor("65500.00", DEFAULT_TDS_POLICY).monthlyTds,
    );
  });

  /**
   * The whole rule, not a reference to it. Policy rows are edited in place, so
   * a stored id would mean next year's rates rewrote the working behind every
   * payslip already issued.
   */
  it("carries the rule itself, and a broken one is refused", () => {
    assert.equal(
      tdsBasisSchema.safeParse({
        ...basis,
        policy: {
          ...DEFAULT_TDS_POLICY,
          slabs: DEFAULT_TDS_POLICY.slabs.slice(0, 5),
        },
      }).success,
      false,
      "a slab table with no open band must not be storable as a basis either",
    );
  });

  it("refuses a negative salary or investment", () => {
    assert.equal(
      tdsBasisSchema.safeParse({ ...basis, annualSalary: "-1.00" }).success,
      false,
    );
    assert.equal(
      tdsBasisSchema.safeParse({ ...basis, declaredInvestment: "-1.00" })
        .success,
      false,
    );
  });

  it("refuses a key nobody defined", () => {
    assert.equal(
      tdsBasisSchema.safeParse({ ...basis, monthlyTds: "1750.00" }).success,
      false,
      "the figure is on the line, not in the basis — two copies would drift",
    );
  });
});
