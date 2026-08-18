import { z } from "zod";

import { fromMinorUnits, toMinorUnits } from "./money.ts";

/**
 * Salary TDS, worked out rather than typed in.
 *
 * This reverses a decision recorded early on — "the app records tax, it does
 * not calculate it; the accountant supplies the numbers" — at the owner's
 * instruction. The reason it is safe to reverse is in the tests beside this
 * file: twelve calculations the company's advisor did by hand are in there as
 * fixtures, and eleven of them agree with this code. The twelfth is an
 * arithmetic slip in the handwriting, which is the argument for the change.
 *
 * Nothing here is hard-coded. Every rate, band and cap arrives as a
 * `TdsPolicy`, because tax rules change every year and a figure baked into a
 * function is a figure somebody has to find and edit under deadline.
 *
 * ---------------------------------------------------------------------------
 * The rebate is computed as a bracket, deliberately
 * ---------------------------------------------------------------------------
 * `(taxable × investmentRate) × rebateRate` collapses to `taxable × 3.75%`, and
 * writing it that way would be shorter and wrong the first time somebody
 * changes 25% to 20% in Settings — the collapsed constant would not move with
 * it. The two steps stay two steps.
 */

/* -------------------------------------------------------------------------- */
/*  The policy                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One band of the slab table.
 *
 * `width` is null on the last band, meaning "everything left". A number would
 * mean choosing an arbitrary ceiling, and the day somebody's income passed it
 * the tax would silently stop growing.
 */
export const tdsBandSchema = z.strictObject({
  width: z.string().nullable(),
  rate: z.number().min(0).max(1),
});
export type TdsBand = z.infer<typeof tdsBandSchema>;

export const tdsPolicySchema = z.strictObject({
  /** 2026 means the income year 2026-27. */
  fiscalYear: z.number().int().min(2000).max(2200),

  /**
   * The part of salary that is not taxed: a fraction of it, capped.
   *
   * Both are settings because both have moved. The advisor's own worksheets
   * for this year use 4,00,000 in the spreadsheets and 4,50,000 in the
   * handwriting — the owner has chosen 4,00,000, and being able to change it
   * from Settings is the point of it being here rather than in the code.
   */
  /*
   * A fraction, kept as two integers rather than a decimal.
   *
   * "One third" has no exact decimal, and the difference is not academic:
   * carrying 0.333333 through paisa arithmetic made a 5,40,000 salary come out
   * at 3,60,000.18 taxable instead of 3,60,000.00 — eighteen paisa of nonsense
   * on a figure the advisor writes as round. Every other rate here terminates
   * (10%, 15%, 3%) and stays a number; only this one cannot.
   */
  exemptionNumerator: z.number().int().min(0),
  exemptionDenominator: z.number().int().min(1),
  exemptionCap: z.string(),

  slabs: z.array(tdsBandSchema).min(1),

  rebate: z.strictObject({
    /**
     * How much of the taxable income is treated as eligible investment.
     *
     * With `assumeFullInvestment` on, this stands in for what somebody
     * actually invested. That is deliberately generous and the owner knows it:
     * it grants the rebate to people who have not invested, which is why it is
     * a switch rather than a constant.
     */
    investmentRate: z.number().min(0).max(1),
    /** The statutory share of eligible investment that becomes rebate. */
    rebateRate: z.number().min(0).max(1),
    /** The other statutory limb: a share of taxable income. */
    taxableShareCap: z.number().min(0).max(1),
    /** And the flat ceiling over both. */
    fixedCap: z.string(),
    assumeFullInvestment: z.boolean(),
  }),

  /**
   * The floor, for somebody who is a taxpayer at all.
   *
   * It applies only once taxable income has passed the first band. Below that
   * a person owes nothing, not the minimum — which is what the advisor's own
   * sheets show: seven of the twelve are under the threshold and every one of
   * them is zero, not 5,000.
   */
  minimumTax: z.string(),
  minimumTaxEnabled: z.boolean(),
});
export type TdsPolicy = z.infer<typeof tdsPolicySchema>;

/**
 * What the advisor's handwriting does, as the starting point.
 *
 * The exemption cap is the owner's choice of 4,00,000 rather than the 4,50,000
 * the handwriting uses — recorded here so the difference is visible rather
 * than lost. Everything else follows the handwritten sheets, because those are
 * what the company's tax was actually filed on.
 */
export const DEFAULT_TDS_POLICY: TdsPolicy = {
  fiscalYear: 2026,
  exemptionNumerator: 1,
  exemptionDenominator: 3,
  exemptionCap: "400000.00",
  slabs: [
    { width: "400000.00", rate: 0 },
    { width: "300000.00", rate: 0.1 },
    { width: "400000.00", rate: 0.15 },
    { width: "500000.00", rate: 0.2 },
    { width: "2000000.00", rate: 0.25 },
    { width: null, rate: 0.3 },
  ],
  rebate: {
    investmentRate: 0.25,
    rebateRate: 0.15,
    taxableShareCap: 0.03,
    fixedCap: "1000000.00",
    assumeFullInvestment: true,
  },
  minimumTax: "5000.00",
  minimumTaxEnabled: true,
};

/* -------------------------------------------------------------------------- */
/*  The calculation                                                           */
/* -------------------------------------------------------------------------- */

/** One band, as it actually applied to this person. */
export type TdsBandResult = {
  /** How much income fell in this band. */
  amount: string;
  rate: number;
  tax: string;
  /** For the screen: "First Tk 4,00,000", "Next Tk 3,00,000", "Remainder". */
  label: string;
};

export type TdsResult = {
  annualSalary: string;
  exemption: {
    byFraction: string;
    cap: string;
    /** The lower of the two, which is what applies. */
    applied: string;
  };
  taxableIncome: string;
  bands: TdsBandResult[];
  taxBeforeRebate: string;
  rebate: {
    /** taxable × investmentRate — what is treated as invested. */
    eligibleInvestment: string;
    /** That, times rebateRate. The first limb. */
    onInvestment: string;
    /** taxable × taxableShareCap. The second. */
    onTaxableIncome: string;
    /** The flat ceiling. The third. */
    fixedCap: string;
    /** The lowest of the three, which is what is granted. */
    applied: string;
  };
  taxAfterRebate: string;
  /** Set when the floor lifted the figure. Null when it did not apply. */
  minimumTaxApplied: string | null;
  netAnnualTax: string;
  monthlyTds: string;
};

/**
 * Money arithmetic in paisa, never in floats.
 *
 * Rates are genuinely fractional, so they cannot be, but everything they touch
 * is converted to an integer number of paisa first and back at the end. The
 * repo's rule is that a taka figure is a `numeric(14,2)` string and JavaScript
 * never adds two of them; this keeps to it by not letting a taka figure exist
 * as a number for longer than one multiplication.
 */
function times(amount: bigint, rate: number): bigint {
  // Rates are given to at most six places, which is what fx rates use.
  const scaled = BigInt(Math.round(rate * 1_000_000));
  return (amount * scaled) / 1_000_000n;
}

const minOf = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

/**
 * @param annualSalary Gross for the year, as a taka string.
 * @param declaredInvestment What the person actually invested, when the policy
 *   is not assuming it. Ignored when `assumeFullInvestment` is on.
 */
export function calculateTds(
  annualSalary: string,
  policy: TdsPolicy,
  declaredInvestment = "0",
): TdsResult {
  const salary = toMinorUnits(annualSalary);

  // Exact: multiply first, divide after, both in paisa.
  const byFraction =
    (salary * BigInt(policy.exemptionNumerator)) /
    BigInt(policy.exemptionDenominator);
  const cap = toMinorUnits(policy.exemptionCap);
  const exemption = minOf(byFraction, cap);
  const taxable = salary - exemption > 0n ? salary - exemption : 0n;

  /* ------------------------------------------------------------- the slabs */
  const bands: TdsBandResult[] = [];
  let remaining = taxable;
  let taxBefore = 0n;

  for (const [index, band] of policy.slabs.entries()) {
    if (remaining <= 0n) break;
    const width = band.width === null ? remaining : toMinorUnits(band.width);
    const inBand = minOf(remaining, width);
    const bandTax = times(inBand, band.rate);

    bands.push({
      amount: fromMinorUnits(inBand),
      rate: band.rate,
      tax: fromMinorUnits(bandTax),
      label:
        band.width === null
          ? "Remainder"
          : index === 0
            ? `First ${band.width}`
            : `Next ${band.width}`,
    });

    taxBefore += bandTax;
    remaining -= inBand;
  }

  /* ------------------------------------------------------------ the rebate */
  // Kept as two multiplications rather than one. See the note at the top: a
  // collapsed constant does not move when the rates are changed in Settings.
  const eligibleInvestment = policy.rebate.assumeFullInvestment
    ? times(taxable, policy.rebate.investmentRate)
    : toMinorUnits(declaredInvestment);
  const onInvestment = times(eligibleInvestment, policy.rebate.rebateRate);
  const onTaxableIncome = times(taxable, policy.rebate.taxableShareCap);
  const fixedCap = toMinorUnits(policy.rebate.fixedCap);
  const rebate = minOf(onInvestment, onTaxableIncome, fixedCap);

  const afterRebate = taxBefore - rebate > 0n ? taxBefore - rebate : 0n;

  /* ----------------------------------------------------------- the minimum */
  // Only for somebody who is a taxpayer at all. Below the first band there is
  // no liability to floor, which is what the advisor's own sheets show.
  const firstBand = toMinorUnits(policy.slabs[0]?.width ?? "0");
  const isTaxpayer = taxable > firstBand;
  const floor = toMinorUnits(policy.minimumTax);
  const floored =
    policy.minimumTaxEnabled && isTaxpayer && afterRebate < floor;
  const net = floored ? floor : afterRebate;

  return {
    annualSalary: fromMinorUnits(salary),
    exemption: {
      byFraction: fromMinorUnits(byFraction),
      cap: fromMinorUnits(cap),
      applied: fromMinorUnits(exemption),
    },
    taxableIncome: fromMinorUnits(taxable),
    bands,
    taxBeforeRebate: fromMinorUnits(taxBefore),
    rebate: {
      eligibleInvestment: fromMinorUnits(eligibleInvestment),
      onInvestment: fromMinorUnits(onInvestment),
      onTaxableIncome: fromMinorUnits(onTaxableIncome),
      fixedCap: fromMinorUnits(fixedCap),
      applied: fromMinorUnits(rebate),
    },
    taxAfterRebate: fromMinorUnits(afterRebate),
    minimumTaxApplied: floored ? fromMinorUnits(floor) : null,
    netAnnualTax: fromMinorUnits(net),
    monthlyTds: fromMinorUnits(net / 12n),
  };
}

/**
 * A part-month, the way the advisor works it out.
 *
 * Divided by thirty rather than by the days the month actually has. That is
 * not an approximation somebody should tidy up later — it is the convention
 * the company's own payroll uses, and February would otherwise pay more per
 * day than March for the same salary.
 */
export function proRataTds(
  monthlyTds: string,
  daysWorked: number,
  daysInMonth = 30,
): string {
  const monthly = toMinorUnits(monthlyTds);
  if (daysInMonth <= 0) return "0.00";
  return fromMinorUnits((monthly * BigInt(daysWorked)) / BigInt(daysInMonth));
}
