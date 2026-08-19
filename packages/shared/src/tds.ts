import { z } from "zod";

import { fromMinorUnits, isValidAmount, toMinorUnits } from "./money.ts";

/**
 * A money figure on a policy: valid, and never negative.
 *
 * These were bare `z.string()`. An adversarial review put "-400000.00" in the
 * exemption cap and watched taxable income come out larger than the salary —
 * 16,00,000 taxable on a 12,00,000 wage, and a monthly deduction of 11,833
 * instead of 1,750. It needs somebody with settings.write to do it, which is
 * why it is not a hole so much as a missing seatbelt; a tax rule with a
 * negative anything in it is not a rule, and the field should say so before
 * the payroll does.
 */
const policyAmountSchema = z
  .string()
  .trim()
  .refine(isValidAmount, "Enter an amount, like 400000 or 400000.00")
  .refine((v) => !v.startsWith("-"), "This cannot be negative");

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
  width: policyAmountSchema.nullable(),
  /**
   * Four decimal places, because that is what the column keeps.
   *
   * `numeric(6,4)` silently rounds 0.12345 to 0.1235 on the way in, so a rate
   * typed with five places showed one figure on the screen that saved it and a
   * different one on the next page load. Refusing it is the smaller surprise.
   */
  rate: z
    .number()
    .min(0)
    .max(1)
    .refine(
      (v) =>
        Number.isInteger(Math.round(v * 10000)) &&
        Math.abs(v * 10000 - Math.round(v * 10000)) < 1e-9,
      "A rate carries at most four decimal places",
    ),
});
export type TdsBand = z.infer<typeof tdsBandSchema>;

/**
 * The three readings of the salary exemption.
 *
 * `lower` — a fraction of the salary or the cap, whichever is smaller. What the
 * company's accountant works to, and what eleven of their twelve handwritten
 * examples come out to.
 * `fraction` — the fraction alone, however large it gets.
 * `cap` — the flat figure, whatever the salary is.
 */
export const TDS_EXEMPTION_MODES = ["lower", "fraction", "cap"] as const;
export const tdsExemptionModeSchema = z.enum(TDS_EXEMPTION_MODES);
export type TdsExemptionMode = z.infer<typeof tdsExemptionModeSchema>;

export const TDS_EXEMPTION_MODE_LABELS: Record<TdsExemptionMode, string> = {
  lower: "The fraction or the cap, whichever is lower",
  fraction: "The fraction only",
  cap: "The cap only",
};

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
  exemptionCap: policyAmountSchema,
  /**
   * Whether the fraction, the cap, or the lower of the two is the exemption.
   *
   * Defaulted rather than required, so a policy row written before this existed
   * keeps behaving exactly as it did.
   */
  exemptionMode: tdsExemptionModeSchema.default("lower"),

  /**
   * The slab table, with the shape its own comments promise.
   *
   * Three files said "the last band has no width, meaning everything above" and
   * not one of them enforced it. A review posted a table with a width on the
   * last band and watched 60,00,000 of income fall off the end untaxed, and
   * another with the open band FIRST, which swallowed a 3,60,000 salary at 30%.
   * Both were accepted by every layer.
   *
   * So the invariant is a rule now rather than a sentence: exactly one open
   * band, and it is the last one.
   */
  slabs: z
    .array(tdsBandSchema)
    .min(1)
    .refine(
      (bands) => bands.filter((b) => b.width === null).length === 1,
      "Exactly one band must be left open, with no width",
    )
    .refine(
      (bands) => bands[bands.length - 1]?.width === null,
      "The open band must be the last one, or income above it is taxed at that band's rate",
    ),

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
    fixedCap: policyAmountSchema,
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
  minimumTax: policyAmountSchema,
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
  exemptionMode: "lower",
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
    /** Which of the two the policy says to use. */
    mode: TdsExemptionMode;
    /** What actually applies, after the mode has chosen. */
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
  /**
   * Which of the two applies.
   *
   * `lower` is the rule the accountant's own worksheets use and the default.
   * The other two exist because the owner asked to be able to run it one way or
   * the other — the Finance Act changes this wording most years, and an app
   * that can only express one reading of it is an app that goes wrong quietly
   * the year the wording moves.
   */
  const exemption =
    policy.exemptionMode === "fraction"
      ? byFraction
      : policy.exemptionMode === "cap"
        ? cap
        : minOf(byFraction, cap);
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
  const floored = policy.minimumTaxEnabled && isTaxpayer && afterRebate < floor;
  const net = floored ? floor : afterRebate;

  return {
    annualSalary: fromMinorUnits(salary),
    exemption: {
      byFraction: fromMinorUnits(byFraction),
      cap: fromMinorUnits(cap),
      mode: policy.exemptionMode,
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

/* -------------------------------------------------------------------------- */
/*  Request contracts                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Saving a year's rule.
 *
 * `fiscalYear` is not in the body — it is the path segment, so a payload
 * cannot claim to be for a year the URL disagrees with.
 */
export const saveTdsPolicySchema = tdsPolicySchema.omit({ fiscalYear: true });
export type SaveTdsPolicyInput = z.infer<typeof saveTdsPolicySchema>;

/**
 * The calculator.
 *
 * A salary and a year. `declaredInvestment` is only read when the policy has
 * `assumeFullInvestment` off, and is here so the calculator can show what
 * switching that off would do to somebody without changing the policy first.
 */
export const calculateTdsSchema = z.strictObject({
  /**
   * Bounded to twelve whole digits, which is what `toMinorUnits` accepts.
   *
   * Unbounded, a slipped keystroke on a crore figure passed validation and
   * then threw a plain Error inside the calculation — and a plain Error is
   * neither a ZodError nor an HttpException, so the exception filter turned a
   * typo into a 500 with a stack trace instead of the message this schema
   * already had ready.
   */
  annualSalary: z
    .string()
    .trim()
    .regex(
      /^\d{1,12}(\.\d{1,2})?$/,
      "Enter an amount, like 1200000 or 1200000.00",
    ),
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
  declaredInvestment: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/)
    .optional(),
});
export type CalculateTdsInput = z.infer<typeof calculateTdsSchema>;

/* -------------------------------------------------------------------------- */
/*  What a payroll line's tax was worked out from                              */
/* -------------------------------------------------------------------------- */

/**
 * The whole working behind one month's deduction, frozen onto the line.
 *
 * The policy itself and not a reference to it. Tax policy rows are edited in
 * place — that is the point of a dynamic rule — so a reference would mean that
 * setting next year's rates silently rewrote the working behind every payslip
 * already issued. An employee asking in March why February deducted what it
 * did must get February's answer.
 *
 * `annualSalary` is stored beside the policy because it is the other half of
 * the sum, and because it is a projection rather than a fact: twelve times the
 * month's gross, which is what the deduction assumes and what will be wrong the
 * moment somebody gets a raise. Keeping it visible is what lets a screen say
 * so.
 */
export const tdsBasisSchema = z.strictObject({
  fiscalYear: z.number().int().min(2000).max(2200),
  annualSalary: policyAmountSchema,
  declaredInvestment: policyAmountSchema,
  /** False when the year asked for had no rule and an earlier one was used. */
  exactYear: z.boolean(),
  policy: tdsPolicySchema,
});
export type TdsBasis = z.infer<typeof tdsBasisSchema>;

/**
 * A month's deduction from a month's gross.
 *
 * The annual figure is twelve times the month, not the person's earnings to
 * date. That is the convention the company's own working uses, and it is the
 * only one available in January for somebody whose salary may change in April:
 * the deduction each month is a twelfth of the tax on the year the month
 * implies. A raise changes the projection from that month on, and the months
 * before it are not restated — which is also how the advisor's sheet behaves.
 */
export function monthlyTdsFor(
  monthlyGross: string,
  policy: TdsPolicy,
  declaredInvestment = "0",
): { monthlyTds: string; annualSalary: string; result: TdsResult } {
  const annualSalary = fromMinorUnits(toMinorUnits(monthlyGross) * 12n);
  const result = calculateTds(annualSalary, policy, declaredInvestment);
  return { monthlyTds: result.monthlyTds, annualSalary, result };
}
