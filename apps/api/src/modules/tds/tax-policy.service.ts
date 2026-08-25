import { Injectable, NotFoundException } from "@nestjs/common";
import {
  DEFAULT_TDS_POLICY,
  tdsExemptionModeSchema,
  calculateTds,
  type TdsPolicy,
  type TdsResult,
} from "@finance/shared";
import { asc, eq } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { taxPolicies, taxPolicyBands } from "../../db/schema";

/**
 * The TDS rule, read from the database and handed to the calculator.
 *
 * The calculation itself lives in `@finance/shared` and takes the policy as an
 * argument, so this service does one thing: turn rows into that argument, and
 * back. Nothing here knows a tax rate.
 *
 * The rates round-trip through `numeric(6,4)`, which is the join everything
 * else depends on. A rate leaves TypeScript as `0.25`, is stored as `0.2500`,
 * and comes back as the string `"0.2500"` — pg hands numerics back as strings
 * so a 14-digit figure is not quietly rounded through a float. Every rate this
 * policy uses terminates within four places, so the trip is lossless; the one
 * value that does not is the exemption fraction, which is why it is a
 * numerator and a denominator rather than a rate at all.
 */
@Injectable()
export class TaxPolicyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The policy for a year.
   *
   * Falls back to the most recent year on or before the one asked for, so a
   * payroll run in a year nobody has configured yet uses the last rule rather
   * than failing — new rates are published late and payroll does not wait.
   * Falling back is announced in the return value; it is not the same as
   * having a policy for the year, and a screen should say so.
   */
  async forYear(
    fiscalYear: number,
  ): Promise<{ policy: TdsPolicy; exact: boolean }> {
    const rows = await this.db.client
      .select()
      .from(taxPolicies)
      .orderBy(asc(taxPolicies.fiscalYear));

    if (rows.length === 0) {
      throw new NotFoundException(
        // The tab is called Salary TDS. This said "Settings → Tax", which was
        // its name once and is not a tab anybody can find now — so the one
        // message a fresh installation ever sees pointed at nothing.
        "No TDS rule has been set up yet. Settings → Salary TDS has the form.",
      );
    }

    const exactRow = rows.find((r) => r.fiscalYear === fiscalYear);
    // Otherwise the latest year that is not in the future of the one asked for.
    const usable =
      exactRow ??
      [...rows].reverse().find((r) => r.fiscalYear <= fiscalYear) ??
      rows[0];

    const bands = await this.db.client
      .select()
      .from(taxPolicyBands)
      .where(eq(taxPolicyBands.policyId, usable.id))
      .orderBy(asc(taxPolicyBands.position));

    return {
      exact: Boolean(exactRow),
      policy: {
        fiscalYear: usable.fiscalYear,
        exemptionNumerator: usable.exemptionNumerator,
        exemptionDenominator: usable.exemptionDenominator,
        exemptionCap: usable.exemptionCap,
        exemptionMode: tdsExemptionModeSchema
          .catch("lower")
          .parse(usable.exemptionMode),
        // An empty band list would mean no tax at any income, silently. The
        // shared default is a rule somebody wrote down rather than the absence
        // of one, and the `exact` flag above is how a screen knows to worry.
        slabs: bands.length
          ? bands.map((b) => ({ width: b.width, rate: Number(b.rate) }))
          : DEFAULT_TDS_POLICY.slabs,
        rebate: {
          investmentRate: Number(usable.rebateInvestmentRate),
          rebateRate: Number(usable.rebateRate),
          taxableShareCap: Number(usable.rebateTaxableShare),
          fixedCap: usable.rebateFixedCap,
          assumeFullInvestment: usable.assumeFullInvestment,
        },
        minimumTax: usable.minimumTax,
        minimumTaxEnabled: usable.minimumTaxEnabled,
      },
    };
  }

  /** Every year that has a rule, newest first, for the Settings picker. */
  async years(): Promise<number[]> {
    const rows = await this.db.client
      .select({ fiscalYear: taxPolicies.fiscalYear })
      .from(taxPolicies)
      .orderBy(asc(taxPolicies.fiscalYear));
    return rows.map((r) => r.fiscalYear).reverse();
  }

  /**
   * What one salary comes to, step by step.
   *
   * The whole working is returned rather than just the figure, because the
   * point of the calculator is checking the app against a piece of paper, and
   * "1,750" on its own cannot be checked against anything.
   */
  async calculate(input: {
    annualSalary: string;
    fiscalYear: number;
    declaredInvestment?: string;
  }): Promise<{ result: TdsResult; policy: TdsPolicy; exact: boolean }> {
    const { policy, exact } = await this.forYear(input.fiscalYear);
    return {
      exact,
      policy,
      result: calculateTds(
        input.annualSalary,
        policy,
        input.declaredInvestment ?? "0",
      ),
    };
  }

  /**
   * Replaces a year's rule.
   *
   * Policy and bands go in one transaction, and the bands are deleted and
   * re-inserted rather than diffed. A half-applied slab table is a tax rule
   * with a hole in it, and diffing rows whose only identity is a position
   * gains nothing over replacing them.
   */
  async save(
    fiscalYear: number,
    input: Omit<TdsPolicy, "fiscalYear">,
    actor: AuthenticatedUser,
  ) {
    return this.audit.mutate({
      action: "settings_change",
      entityTable: "tax_policies",
      entityId: String(fiscalYear),
      summary: `${actor.fullName} changed the TDS rule for ${fiscalYear}-${String(fiscalYear + 1).slice(2)}`,
      module: "tds",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(taxPolicies)
          .where(eq(taxPolicies.fiscalYear, fiscalYear))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const values = {
          exemptionNumerator: input.exemptionNumerator,
          exemptionDenominator: input.exemptionDenominator,
          exemptionCap: input.exemptionCap,
          exemptionMode: input.exemptionMode,
          rebateInvestmentRate: String(input.rebate.investmentRate),
          rebateRate: String(input.rebate.rebateRate),
          rebateTaxableShare: String(input.rebate.taxableShareCap),
          rebateFixedCap: input.rebate.fixedCap,
          assumeFullInvestment: input.rebate.assumeFullInvestment,
          minimumTax: input.minimumTax,
          minimumTaxEnabled: input.minimumTaxEnabled,
          updatedAt: new Date(),
          updatedBy: actor.id,
        };

        const [existing] = await tx
          .select({ id: taxPolicies.id })
          .from(taxPolicies)
          .where(eq(taxPolicies.fiscalYear, fiscalYear))
          .limit(1);

        const [saved] = existing
          ? await tx
              .update(taxPolicies)
              .set(values)
              .where(eq(taxPolicies.id, existing.id))
              .returning()
          : await tx
              .insert(taxPolicies)
              .values({ ...values, fiscalYear, createdBy: actor.id })
              .returning();

        await tx
          .delete(taxPolicyBands)
          .where(eq(taxPolicyBands.policyId, saved.id));

        await tx.insert(taxPolicyBands).values(
          input.slabs.map((band, index) => ({
            policyId: saved.id,
            // Renumbered from the array's own order, so a gap or a duplicate
            // in what arrived cannot reach the table.
            position: index + 1,
            width: band.width,
            rate: String(band.rate),
          })),
        );

        return saved;
      },
    });
  }
}
