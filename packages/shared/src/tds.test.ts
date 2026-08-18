import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TDS_POLICY,
  calculateTds,
  proRataTds,
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
    { name: "Omare Ahamed Sakib", monthly: 45000, taxable: "360000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "Khairul Bashar", monthly: 37000, taxable: "296000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "Amir Faysal", monthly: 30000, taxable: "240000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "Shahriar Hossain", monthly: 42000, taxable: "336000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "Sagar Biswas", monthly: 46000, taxable: "368000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "Rukiya Islam Tazin", monthly: 40000, taxable: "320000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },
    { name: "SM Showkot Hasan", monthly: 43000, taxable: "344000.00", beforeRebate: "0.00", net: "0.00", monthlyTds: "0.00" },

    // Over the threshold, but the rebate wipes the liability out — so the
    // floor lifts them back to 5,000.
    { name: "Ibne Saleheen", monthly: 67000, taxable: "536000.00", beforeRebate: "13600.00", net: "5000.00", monthlyTds: "416.66" },
    { name: "(unnamed, 62k)", monthly: 62000, taxable: "496000.00", beforeRebate: "9600.00", net: "5000.00", monthlyTds: "416.66" },

    // Ordinary taxpayers.
    { name: "MD. Yeasin Hossain", monthly: 100000, taxable: "800000.00", beforeRebate: "45000.00", net: "21000.00", monthlyTds: "1750.00" },
    { name: "Emon Reja", monthly: 200000, taxable: "1950000.00", beforeRebate: "277500.00", net: "219000.00", monthlyTds: "18250.00" },
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
    assert.notEqual(r.taxBeforeRebate, "32000.00", "the handwriting says 32,000");

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
      rebate: { ...DEFAULT_TDS_POLICY.rebate, investmentRate: 0.5, taxableShareCap: 1 },
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
    assert.notEqual(proRataTds("3000.00", 28, 28), proRataTds("3000.00", 28, 30));
  });
});
