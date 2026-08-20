import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  todayInDhaka,
  type FxContext,
  type FxReportBasis,
  type GoverningRateSource,
  type ListFxRatesQuery,
  type Paginated,
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

  /**
   * A page of rates, newest first, with the whole count beside it.
   *
   * It used to take a `limit` and return a bare array — so the screen showed
   * its newest ninety and there was no way to reach the ninety-first, and no
   * indication one existed. A `Paginated` envelope is what lets the table say
   * how many there are and offer the rest.
   */
  async list(query: ListFxRatesQuery) {
    const where: SQL[] = [];
    if (query.from) where.push(gte(fxRates.rateDate, query.from));
    if (query.to) where.push(lte(fxRates.rateDate, query.to));
    const filter = where.length ? and(...where) : undefined;

    const [items, [counted]] = await Promise.all([
      this.db.client
        .select()
        .from(fxRates)
        .where(filter)
        .orderBy(desc(fxRates.rateDate))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      // Counted over the same filter, not over the page — a total that means
      // the visible rows is the wrong number on every screen in this app.
      this.db.client
        .select({ total: sql<number>`count(*)::int` })
        .from(fxRates)
        .where(filter),
    ]);

    const total = counted?.total ?? 0;
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
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

  /**
   * Remove a recorded rate.
   *
   * A real delete rather than a void, and the difference is deliberate: a
   * voided ledger row stays visible because money moved and the record of it
   * must survive being wrong. A rate is not a movement — it is a stated fact
   * about a day, and a wrong one that stays on the page keeps translating
   * figures at a number somebody has already disowned.
   *
   * The audit log keeps the before-image, so what the rate said is still
   * answerable after it is gone.
   *
   * Nothing here re-translates history. Every transaction that carries its own
   * `fx_rate` keeps it — that is a recorded fact about the day money moved,
   * not a lookup — so deleting a rate changes what *future* reads translate at
   * and leaves what actually happened alone.
   */
  // No `actor` parameter: `audit.mutate` reads who is acting from the request
  // context, and this method writes no `updatedBy` of its own — the row is
  // going away. `set` takes one because it stamps the row it keeps.
  async remove(id: string) {
    return this.audit.mutate({
      action: "delete",
      entityTable: "fx_rates",
      entityId: id,
      summary: "Removed a recorded USD rate",
      module: "fx",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(fxRates)
          .where(eq(fxRates.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .delete(fxRates)
          .where(eq(fxRates.id, id))
          .returning();

        if (!row) {
          throw new NotFoundException("That rate no longer exists.");
        }
        return row;
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
   * The one rate a period is read in dollars at, and where it came from.
   *
   * This is the whole rule, in one place, in the owner's order:
   *
   *   1. What the month was funded at. Money arriving from abroad arrives at a
   *      known rate — the bank has just said so — and everything spent
   *      afterwards is spending that money.
   *   2. Otherwise the rate set in Settings.
   *   3. Otherwise whatever the rate table holds.
   *
   * Step 2 is the fix for a real complaint: in `live` mode the number somebody
   * types into Settings was never read at all, so editing it appeared to do
   * nothing. A rate a person set by hand is now always consulted — it just
   * yields to the month's own funding, which is a recorded fact about money
   * that actually moved rather than a reference figure.
   *
   * The source travels with the rate because "I changed it and nothing
   * happened" is only confusing while the screen refuses to say which of the
   * three won.
   */
  async governingRateFor(period: {
    start: string;
    end: string;
  }): Promise<{ rate: string; source: GoverningRateSource } | null> {
    const funded = await this.fundingRateFor(period);
    if (funded) return { rate: funded, source: "funding" };

    const settings = await this.settings.get();
    const fixed = settings.fxFixedUsdBdt;

    // Second in *both* modes, which is the whole point.
    //
    // This used to be taken only when `fxMode === "fixed"`, leaving `live` mode
    // ordered funding → table → settings. That inverts the rule and reproduces
    // the original complaint exactly: with any row at all in the rate table,
    // editing the Settings rate changed nothing. Whether the number is read
    // from a table is a mechanism; which number a person typed by hand is an
    // instruction, and the instruction outranks it.
    if (fixed && Number(fixed) > 0) {
      return { rate: fixed, source: "settings" };
    }

    const context = await this.contextFor(period);
    if (!context.unavailable && Number(context.rate) > 0) {
      return { rate: context.rate, source: "table" };
    }

    return null;
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
