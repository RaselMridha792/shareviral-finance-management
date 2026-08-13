import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  todayInDhaka,
  type FxContext,
  type FxReportBasis,
  type ListFxRatesQuery,
  type SetFxRateInput,
} from "@finance/shared";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { fxRates, transactions } from "../../db/schema";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class FxService {
  private readonly log = new Logger(FxService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: ListFxRatesQuery) {
    const where: SQL[] = [];
    if (query.from) where.push(gte(fxRates.rateDate, query.from));
    if (query.to) where.push(lte(fxRates.rateDate, query.to));

    return this.db.client
      .select()
      .from(fxRates)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(fxRates.rateDate))
      .limit(query.limit);
  }

  /** Records a rate by hand. Re-recording the same day replaces it. */
  async set(input: SetFxRateInput, actor: AuthenticatedUser) {
    if (input.rateDate > todayInDhaka()) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { rateDate: ["That date has not happened yet"] },
      });
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "fx_rates",
      summary: `Set the USD rate for ${input.rateDate} to ${input.rate}`,
      module: "fx",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(fxRates)
          .where(eq(fxRates.rateDate, input.rateDate))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .insert(fxRates)
          .values({
            baseCurrency: "USD",
            quoteCurrency: "BDT",
            rate: input.rate,
            rateDate: input.rateDate,
            source: "manual",
            notes: input.notes,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .onConflictDoNothing()
          .returning();

        if (row) return row;

        // The day already has a rate, so replace it. This is a plain update
        // rather than `onConflictDoUpdate` because the unique index is on a
        // coalesced expression, which cannot be named as a conflict target.
        const [replaced] = await tx
          .update(fxRates)
          .set({
            rate: input.rate,
            source: "manual",
            notes: input.notes,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(
            and(
              eq(fxRates.rateDate, input.rateDate),
              eq(fxRates.baseCurrency, "USD"),
              eq(fxRates.quoteCurrency, "BDT"),
            ),
          )
          .returning();
        return replaced;
      },
    });
  }

  /* ---------------------------------------------------------------------- */

  /**
   * The rate the month itself was funded at.
   *
   * When money arrives from abroad the person recording it knows exactly what
   * a dollar was worth that day, because the bank has just told them. That
   * figure then governs the whole month: every taka amount the company spends
   * afterwards is spending *that* money, so reading it back in dollars at the
   * rate it arrived at is the honest translation.
   *
   * Only the funding sets it. An entry with its own rate keeps its own — a
   * tool bought on the card is charged at whatever the card's rate was that
   * day, not at the rate the month's transfer landed at.
   *
   * Null when nothing was funded in the period, and the caller falls back to
   * the settings rate and marks the figures estimated.
   */
  async fundingRateFor(period: {
    start: string;
    end: string;
  }): Promise<string | null> {
    const [row] = await this.db.client
      .select({
        rate: transactions.fxRate,
        usdRate: transactions.usdRate,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.txnDate, period.start),
          lte(transactions.txnDate, period.end),
          eq(transactions.direction, "in"),
          isNull(transactions.voidedAt),
          sql`(${transactions.fxRate} is not null or ${transactions.usdRate} is not null)`,
        ),
      )
      // The first funding of the period sets it — that is the one recorded at
      // the start of the month, which is what the rule describes.
      .orderBy(asc(transactions.txnDate), asc(transactions.createdAt))
      .limit(1);

    const rate = row?.rate ?? row?.usdRate ?? null;
    return rate && Number(rate) > 0 ? rate : null;
  }

  /**
   * The rate to translate a period's figures with, and the sentence explaining
   * it.
   *
   * Never throws and never blocks. A month-end close must not fail because a
   * rate is missing — it should show the taka and say plainly that it could not
   * convert. `unavailable: true` is the caller's cue to keep showing BDT.
   */
  async contextFor(
    period: { start: string; end: string },
    override?: FxReportBasis,
  ): Promise<FxContext> {
    const settings = await this.settings.get();
    const basis = override ?? settings.fxReportBasis;

    try {
      if (settings.fxMode === "fixed") {
        const rate = settings.fxFixedUsdBdt;
        if (!rate || Number(rate) <= 0) return unavailable(basis);
        return {
          rate,
          asOf: period.end,
          basis,
          source: "manual",
          caption: `translated at ${trim(rate)}, the fixed rate in Settings`,
          unavailable: false,
        };
      }

      const found = await this.rateFor(period, basis);
      if (!found) return unavailable(basis);

      return {
        rate: found.rate,
        asOf: found.asOf,
        basis,
        source: found.source,
        caption: captionFor(found.rate, found.asOf, basis, found.stale),
        unavailable: false,
      };
    } catch (error) {
      // Reporting in taka is always possible; failing the whole report because
      // the rate lookup broke is not a trade worth making.
      this.log.warn(
        `Could not resolve an exchange rate for ${period.start}–${period.end}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return unavailable(basis);
    }
  }

  private async rateFor(
    period: { start: string; end: string },
    basis: FxReportBasis,
  ): Promise<{
    rate: string;
    asOf: string;
    source: "manual" | "api";
    stale: boolean;
  } | null> {
    if (basis === "period_average") {
      const [row] = await this.db.client
        .select({
          rate: sql<string>`round(avg(${fxRates.rate}), 6)::text`,
          days: sql<number>`count(*)::int`,
        })
        .from(fxRates)
        .where(
          and(
            gte(fxRates.rateDate, period.start),
            lte(fxRates.rateDate, period.end),
          ),
        );

      if (row?.rate && Number(row.days) > 0) {
        return {
          rate: row.rate,
          asOf: period.end,
          source: "manual",
          stale: false,
        };
      }
      // Fall through: an average of nothing is not an average.
    }

    // period_end, current, or an average with no data behind it: the latest
    // rate on or before the target day.
    const target = basis === "current" ? todayInDhaka() : period.end;

    const [row] = await this.db.client
      .select()
      .from(fxRates)
      .where(lte(fxRates.rateDate, target))
      .orderBy(desc(fxRates.rateDate))
      .limit(1);

    if (!row) return null;

    return {
      rate: row.rate,
      asOf: row.rateDate,
      source: row.source,
      // More than a week old is worth saying out loud at month end.
      stale: daysBetween(row.rateDate, target) > 7,
    };
  }

  /**
   * Converts a BDT figure. Returns null when there is no rate, so a caller that
   * forgets to check renders nothing rather than a fabricated number.
   */
  static convert(amountBdt: string, fx: FxContext | null): string | null {
    if (!fx || fx.unavailable) return null;
    const rate = Number(fx.rate);
    if (!rate) return null;
    return (Number(amountBdt) / rate).toFixed(2);
  }
}

/* -------------------------------------------------------------------------- */

function unavailable(basis: FxReportBasis): FxContext {
  return {
    rate: "0",
    asOf: todayInDhaka(),
    basis,
    source: "manual",
    caption:
      "no exchange rate on record for this period — showing taka. Add one in Settings.",
    unavailable: true,
  };
}

function captionFor(
  rate: string,
  asOf: string,
  basis: FxReportBasis,
  stale: boolean,
): string {
  const how =
    basis === "period_average"
      ? "the average across the period"
      : basis === "current"
        ? "today's rate"
        : "the period-end rate";

  return (
    `translated at ${trim(rate)}, as of ${asOf} (${how})` +
    (stale ? " — the last rate on record, which is over a week old" : "")
  );
}

/** 118.400000 reads as a database artefact; 118.40 reads as a rate. */
function trim(rate: string): string {
  const n = Number(rate);
  return n.toFixed(n % 1 === 0 ? 2 : Math.min(4, decimals(rate)));
}

function decimals(value: string): number {
  const trimmed = value.replace(/0+$/, "");
  const dot = trimmed.indexOf(".");
  return dot === -1 ? 2 : Math.max(2, trimmed.length - dot - 1);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.abs(b - a) / 86_400_000;
}
