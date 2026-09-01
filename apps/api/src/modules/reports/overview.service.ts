import { Injectable } from "@nestjs/common";
import {
  currentFiscalYear,
  monthRange,
  periodsInFiscalYear,
  todayInDhaka,
  type AccountGroup,
  type CategoryLine,
  type MonthStat,
  type OverviewEntry,
  type OverviewQuery,
  type OverviewReport,
  type OverviewVendor,
  type PeriodRange,
  GOVERNING_RATE_LABELS,
} from "@finance/shared";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import {
  accounts,
  categories,
  tdsDeposits,
  teamMembers,
  transactions,
  vendors,
} from "../../db/schema";
import { FxService } from "../fx/fx.service";
import { isToolSpend } from "../vendors/tool-spend";
import { SettingsService } from "../settings/settings.service";
import { TdsService } from "../tds/tds.service";
import { CHALLAN_COUNTS } from "../tds/challan-counts";
import { notATransfer } from "../transactions/own-money";
import { periodDollars } from "./own-dollars";

/** Never count a voided row. It stays visible; it is not money. */
const LIVE = isNull(transactions.voidedAt);

/** How many months of history the trend line shows. */
const TREND_MONTHS = 12;

/**
 * The overview screen, in one request.
 *
 * Every figure here is summed in SQL against the same columns the detail
 * screens use, so a total on the dashboard and the list it came from cannot
 * disagree. Where a number is period-bound it says so, and where it is not —
 * cash in hand, tax still owed — it is deliberately not, because pretending an
 * obligation belongs to a month is how one gets forgotten at the year end.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    private readonly tds: TdsService,
  ) {}

  async build(query: OverviewQuery): Promise<OverviewReport> {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const fiscalYear = query.fiscalYear ?? currentFiscalYear(mode);

    const all = periodsInFiscalYear(fiscalYear, mode, query.granularity);

    // Asked for nothing in particular, the overview means "now". Defaulting to
    // the first period of the year would open a dashboard on July every August.
    const today = todayInDhaka();
    const index = query.index
      ? Math.min(query.index, all.length) - 1
      : Math.max(
          all.findIndex((p) => p.start <= today && today <= p.end),
          0,
        );

    const range = all[index];
    const before = index > 0 ? all[index - 1] : null;

    const [
      totals,
      previousTotals,
      cashInHand,
      salaryPaid,
      previousSalary,
      funding,
      previousFunding,
      tax,
      outstanding,
      spend,
      income,
      topVendors,
      balances,
      recent,
      headcount,
      months,
      groups,
      toolsSpend,
    ] = await Promise.all([
      this.totalsFor(range),
      before ? this.totalsFor(before) : Promise.resolve(null),
      this.cashInHand(),
      this.salaryPaid(range),
      before ? this.salaryPaid(before) : Promise.resolve("0.00"),
      this.funding(range),
      before ? this.funding(before) : Promise.resolve("0.00"),
      this.taxMoved(range),
      this.taxOutstanding(),
      this.byCategory(range, "out"),
      this.byCategory(range, "in"),
      this.topVendors(range),
      this.balances(),
      this.recent(),
      this.headcount(),
      this.trend(range.end),
      this.accountGroups(range),
      this.toolsAndSubscriptions(range),
    ]);

    /**
     * Every figure now carries its dollars beside it rather than behind a
     * toggle, so the taka is never converted away — `convert` is a no-op and
     * the USD half is produced separately.
     *
     * The rate is the month's own: money that arrives from abroad arrives at a
     * known rate, and everything spent afterwards is spending that money. The
     * settings rate is reached only when nothing was funded in the period.
     */
    const tableFx = await this.fx.contextFor(range);
    // One resolver, not a rule reimplemented here: funded rate, then the rate
    // set in Settings, then the table. `FxService.governingRateFor` is the
    // only place that order is written down.
    const governing = await this.fx.governingRateFor(range);
    const usdRate = governing?.rate ?? null;

    /**
     * The context reported to the caller, describing the rate actually used.
     *
     * `contextFor` only knows what the rate *table* holds, so on a month
     * funded from abroad — or one falling back to the Settings rate — it can
     * come back `unavailable: true` with the caption "no exchange rate on
     * record for this period". Returned unchanged beside a populated `usdRate`
     * and a full set of dollar figures, that is a response arguing with
     * itself, and any screen rendering `fx.caption` would print "not
     * converted" over converted numbers.
     */
    const fx =
      governing && tableFx.unavailable
        ? {
            ...tableFx,
            rate: governing.rate,
            unavailable: false,
            caption: `translated at ${trimRate(governing.rate)} — ${GOVERNING_RATE_LABELS[governing.source]}`,
          }
        : tableFx;

    const currency = "BDT" as const;
    const convert = (value: string) => value;
    const convertLine = <T extends { total: string }>(line: T) => ({ ...line });
    /**
     * The approximate dollars beside a taka figure, or null with no rate.
     *
     * `unavailable: false` is not cosmetic. `fx` describes what the *rate
     * table* could answer, and `convert` refuses outright when that flag is
     * set. But a month funded from abroad has a rate whether or not anybody
     * ever filled in Settings — `fundingRateFor` found it on the transfer
     * itself. Spreading `fx` unchanged carried its "no rate" verdict into a
     * call that does have one, so every dollar figure came back null while the
     * heading above them read "dollars shown at 118.30 per USD".
     *
     * Rebuilt rather than spread through, so the two can no longer disagree:
     * if `usdRate` is set the conversion happens, and if it is not, nothing is
     * shown at all.
     */
    /*
     * The period's dollars, added up rather than divided out of taka.
     *
     * The owner's rule: "report ta calculate hobe kono fx rate theke na, karon
     * prottekta transaction a manual dollar type er option ache." Dividing a
     * taka total by one governing rate reported dollars nobody ever had, and
     * moved them whenever anybody edited the rate in Settings — the same
     * mistake that made $14,000 read back as $13,485 on the accounts screen.
     */
    const dollars = periodDollars(range);
    const [dollarRow] = await this.db.client
      .select({
        moneyIn: dollars.moneyIn,
        moneyOut: dollars.moneyOut,
        exact: dollars.exact,
      })
      .from(transactions)
      .where(dollars.where);

    const usdIn = dollarRow?.moneyIn ?? "0.00";
    const usdOut = dollarRow?.moneyOut ?? "0.00";
    const usdNet = (Number(usdIn) - Number(usdOut)).toFixed(2);
    const usdExact = dollarRow?.exact ?? true;

    /**
     * No dollar view for a figure that is not a sum of row dollars.
     *
     * Salary, tools spend, tax withheld and tax outstanding are taka facts:
     * payroll is computed, filed and paid in taka, and not one row of it
     * carries a dollar figure anybody typed. A per-account opening or closing
     * balance is the same — the accounts screen answers that question properly
     * from each row's own dollars, and it is the place to answer it.
     *
     * Returning null is the whole point. The alternative is to divide by a
     * rate, which is the thing being removed, and a figure invented that way
     * is worse than an absent one because it looks like an answer.
     */
    const noDollarView = (): string | null => null;

    return {
      period: {
        label: range.label,
        start: range.start,
        end: range.end,
        granularity: query.granularity,
      },
      currency,
      fx,
      usdRate,
      usdRateSource: governing?.source ?? null,
      /*
       * Whether every row in the period carried a dollar figure. False means
       * the dollar totals are a floor rather than the whole, and the screen
       * marks them — the same contract `ownBalanceExact` uses on an account,
       * so the two cannot disagree about what a tilde means.
       */
      usdExact,
      usdTotals: { moneyIn: usdIn, moneyOut: usdOut, net: usdNet },
      totals: {
        moneyIn: convert(totals.moneyIn),
        moneyOut: convert(totals.moneyOut),
        net: convert(totals.net),
        entries: totals.entries,
        cashInHand: convert(cashInHand),
        salaryPaid: convert(salaryPaid),
        fundingReceived: convert(funding),
        taxWithheld: convert(tax.withheld),
        taxDeposited: convert(tax.deposited),
        taxOutstanding: convert(outstanding),
      },
      previous:
        previousTotals && before
          ? {
              label: before.label,
              moneyIn: convert(previousTotals.moneyIn),
              moneyOut: convert(previousTotals.moneyOut),
              net: convert(previousTotals.net),
              salaryPaid: convert(previousSalary),
              fundingReceived: convert(previousFunding),
            }
          : null,
      months: months.map((month) => ({
        ...month,
        moneyIn: convert(month.moneyIn),
        moneyOut: convert(month.moneyOut),
        net: convert(month.net),
        closingBalance: convert(month.closingBalance),
      })),
      spendByCategory: spend.map(convertLine),
      incomeByCategory: income.map(convertLine),
      topVendors: topVendors.map(convertLine),
      balances: balances.map((account) => ({
        ...account,
        balance: convert(account.balance),
      })),
      recent: recent.map((entry) => ({
        ...entry,
        amount: convert(entry.amount),
      })),
      /*
       * `groups` already carries its own dollars, summed from the rows.
       *
       * This used to null all four out — the `noDollarView()` #8 left behind
       * when it removed the rate-based conversion — and the owner's answer to
       * "then how" is the one this app already had for balances: add up what
       * the transactions themselves recorded. "aigula kono fx rate theke
       * hobena. prottekta transaction er usd amount o save hoy oitai jog hobe."
       *
       * So nothing is mapped here any more. `accountGroups` computes the four
       * dollar figures beside the four taka ones, from one query, and the
       * closing is derived from the other three so that opening + in - out
       * reads as a sentence that adds up.
       */
      groups,
      expense: {
        salaryPaid,
        toolsAndSubscriptions: toolsSpend,
        taxWithheld: tax.withheld,
        taxOutstanding: outstanding,
        usd: {
          salaryPaid: noDollarView(),
          toolsAndSubscriptions: noDollarView(),
          taxWithheld: noDollarView(),
          taxOutstanding: noDollarView(),
        },
      },
      headcount,
    };
  }

  /* ---------------------------------------------------------------------- */

  private async totalsFor(range: PeriodRange) {
    /*
     * The company's own money, so transfers between our accounts are left
     * out — both halves, which is why the net is unchanged and both figures
     * become honest rather than one of them. The per-account blocks below
     * deliberately keep them: money did leave that card.
     */
    const [row] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(inPeriod(range), notATransfer()));

    return {
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      net: (Number(row.moneyIn) - Number(row.moneyOut)).toFixed(2),
      entries: Number(row.entries),
    };
  }

  /**
   * What is actually in the accounts, today.
   *
   * Not period-bound and not a sum of the period's net: a balance is every
   * opening balance plus everything that has ever moved, which is the figure
   * somebody compares against a bank app.
   */
  private async cashInHand(): Promise<string> {
    const [opening] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const [moved] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(LIVE);

    return (Number(opening.total) + Number(moved.net)).toFixed(2);
  }

  /**
   * Salary that left the bank, taken from the ledger rather than the payroll
   * sheet.
   *
   * A finalised run is an intention; the ledger row is the money. Reading the
   * sheet would show pay as "spent" in the month it was calculated, which is
   * not the month the bank saw it.
   */
  private async salaryPaid(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          inPeriod(range),
          eq(transactions.direction, "out"),
          eq(transactions.createdVia, "payroll"),
        ),
      );

    return Number(row.total).toFixed(2);
  }

  /**
   * BDT that landed from a foreign remittance — what the CEO sent, as received.
   *
   * `original_currency is not null` is the whole test for "this came from
   * abroad", and a transfer entered in dollars satisfies it: `transfer()`
   * stamps originalCurrency, originalAmount and the rate onto BOTH halves, so
   * loading the USD card from the bank made the card's `in` half read as new
   * money arriving from the CEO — the company's own funds counted a second
   * time, on top of the remittance that really did arrive.
   *
   * Not visible on the dev database, where every account is BDT and the form
   * never opens its dollar mode. It is reachable the moment one account is
   * USD-primary, which on the live site several are.
   */
  private async funding(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          inPeriod(range),
          notATransfer(),
          eq(transactions.direction, "in"),
          sql`${transactions.originalCurrency} is not null`,
        ),
      );

    return Number(row.total).toFixed(2);
  }

  private async taxMoved(range: PeriodRange) {
    const [withheld] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(inPeriod(range), eq(transactions.direction, "out")));

    const [deposited] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
      })
      .from(tdsDeposits)
      .where(
        and(
          gte(tdsDeposits.depositDate, range.start),
          lte(tdsDeposits.depositDate, range.end),
          // Neither a trashed challan nor one whose payment was voided.
          CHALLAN_COUNTS,
        ),
      );

    return {
      withheld: Number(withheld.total).toFixed(2),
      deposited: Number(deposited.total).toFixed(2),
    };
  }

  /**
   * Held back and not yet handed to the treasury, all time.
   *
   * Delegated to `TdsService`, which is where the TDS screen's own figure comes
   * from. This used to be a local copy that counted only vendor withholding
   * against every challan including the salary ones, so it reported 0.00 while
   * the TDS screen reported the real ৳10,800 — two screens disagreeing about
   * one obligation. There is one implementation now.
   */
  private taxOutstanding(): Promise<string> {
    return this.tds.outstandingAllTime();
  }

  /**
   * Every account, each with where it started, what moved, and where it stands.
   *
   * One block per account. It used to be two — every taka account summed into
   * "BD Bank overview", the dollar ones into "Card overview" — which put the
   * bank, the card and the petty cash tin behind a single set of four figures
   * with their names listed in grey beside it. The owner has two accounts and
   * saw one row: the question "what is on the card" had no answer on the
   * screen that exists to answer it.
   *
   * Opening is the account's own opening balance plus everything that moved
   * before the period, so `opening + in - out` lands exactly on `closing`. The
   * four tiles in a block have to tie together or they are four unrelated
   * numbers in a box.
   *
   * Soft-deleted accounts are out; archived ones are not. An account somebody
   * stopped using still holds whatever it held, and a dashboard that quietly
   * drops a balance is worse than one carrying a block nobody looks at.
   */
  /* Returns the dollars with the taka now, rather than leaving a caller to
     null them in — which is what the Omit here used to allow. */
  private async accountGroups(range: PeriodRange): Promise<AccountGroup[]> {
    const rows = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        bankName: accounts.bankName,
        accountNumber: accounts.accountNumber,
        currency: accounts.currency,
        opening: accounts.openingBalance,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .orderBy(accounts.sortOrder, accounts.name);

    if (!rows.length) return [];

    const [movedBefore, inPeriodRows] = await Promise.all([
      this.db.client
        .select({
          accountId: transactions.accountId,
          net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
          /*
           * The same net, in the dollars the ROWS carry.
           *
           * The owner: "aigula kono fx rate theke hobena. prottekta transaction
           * er usd amount o save hoy oitai jog hobe." So this is a sum, never a
           * division — a figure divided out of taka changes on its own the
           * moment somebody edits a rate, which is what #8 removed.
           *
           * Signed, so money in adds and money out subtracts, exactly as the
           * taka net beside it does.
           */
          netUsd: sql<string>`coalesce(sum(
            case
              when ${transactions.originalCurrency} = 'USD'
                   and ${transactions.originalAmount} is not null
              then case when ${transactions.direction} = 'in'
                        then ${transactions.originalAmount}
                        else -${transactions.originalAmount} end
              else 0
            end), 0)::text`,
        })
        .from(transactions)
        .where(and(sql`${transactions.txnDate} < ${range.start}`, LIVE))
        .groupBy(transactions.accountId),

      this.db.client
        .select({
          accountId: transactions.accountId,
          moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
          moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
          /* Each direction's dollars, summed from the rows that carry one. */
          moneyInUsd: sql<string>`coalesce(sum(
            case when ${transactions.direction} = 'in'
                  and ${transactions.originalCurrency} = 'USD'
                  and ${transactions.originalAmount} is not null
                 then ${transactions.originalAmount} else 0 end), 0)::text`,
          moneyOutUsd: sql<string>`coalesce(sum(
            case when ${transactions.direction} = 'out'
                  and ${transactions.originalCurrency} = 'USD'
                  and ${transactions.originalAmount} is not null
                 then ${transactions.originalAmount} else 0 end), 0)::text`,
          /*
           * Whether EVERY row in the period carried a dollar figure.
           *
           * False means the dollar totals are a floor rather than the whole,
           * and the screen marks them with a tilde — the same contract
           * `ownBalanceExact` uses on an account, so the two cannot disagree
           * about what a tilde means.
           *
           * `coalesce(..., true)` because `bool_and` over no rows is NULL, and
           * an account that saw no movement is not inexact.
           */
          allHaveUsd: sql<boolean>`coalesce(bool_and(
            ${transactions.originalCurrency} = 'USD'
            and ${transactions.originalAmount} is not null
          ), true)`,
        })
        .from(transactions)
        .where(inPeriod(range))
        .groupBy(transactions.accountId),
    ]);

    const before = new Map(
      movedBefore.map((r) => [
        r.accountId,
        { net: Number(r.net), netUsd: Number(r.netUsd) },
      ]),
    );
    const during = new Map(
      inPeriodRows.map((r) => [
        r.accountId,
        {
          in: Number(r.moneyIn),
          out: Number(r.moneyOut),
          inUsd: Number(r.moneyInUsd),
          outUsd: Number(r.moneyOutUsd),
          exact: r.allHaveUsd,
        },
      ]),
    );

    const groups = rows.map((account) => {
      const carried = before.get(account.id);
      const opening = Number(account.opening) + (carried?.net ?? 0);
      const movement = during.get(account.id);
      const moneyIn = movement?.in ?? 0;
      const moneyOut = movement?.out ?? 0;

      /*
       * The dollars, added up.
       *
       * An account's OPENING has no dollar figure of its own — it is the
       * account's opening balance, typed in taka, plus everything that moved
       * before this month. Only the second half carries dollars, so the
       * opening's dollar view is the dollars that moved before the period.
       */
      const openingUsd = carried?.netUsd ?? 0;
      const moneyInUsd = movement?.inUsd ?? 0;
      const moneyOutUsd = movement?.outUsd ?? 0;

      /* Nothing at all in dollars is not the same as zero dollars: a taka-only
         account shows no second line rather than "$0.00", which would read as a
         fact somebody established. */
      const anyDollars =
        openingUsd !== 0 || moneyInUsd !== 0 || moneyOutUsd !== 0;
      const usdOr = (value: number) => (anyDollars ? value.toFixed(2) : null);

      return {
        key: account.id,
        label: account.name,
        type: account.type,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        currency: account.currency,
        opening: opening.toFixed(2),
        moneyIn: moneyIn.toFixed(2),
        moneyOut: moneyOut.toFixed(2),
        closing: (opening + moneyIn - moneyOut).toFixed(2),
        usd: {
          opening: usdOr(openingUsd),
          moneyIn: usdOr(moneyInUsd),
          moneyOut: usdOr(moneyOutUsd),
          /* Derived from the other three rather than summed again, so
             opening + in - out reads as a sentence that adds up. */
          closing: usdOr(openingUsd + moneyInUsd - moneyOutUsd),
          /* False when some row in the period carried no dollar figure: the
             totals are then a floor, and the screen says so with a tilde. */
          exact: movement?.exact ?? true,
        },
      };
    });

    /*
     * An account the month never touched, standing at zero, says nothing —
     * it is a card kept for later or a bank switched away from, and four
     * cells of ৳0.00 under its name only push the accounts that did move
     * further down the page. The owner's rule: zero balance and no movement,
     * off the dashboard. The Accounts screen still lists every account, so
     * nothing is hidden — only unreported here.
     *
     * The test is all four figures at once, not the balance alone: an account
     * that moved during the month and happens to land back on zero was used,
     * and hiding it would hide the month's own story.
     */
    return groups.filter(
      (group) =>
        Number(group.opening) !== 0 ||
        Number(group.moneyIn) !== 0 ||
        Number(group.moneyOut) !== 0,
    );
  }

  /**
   * What went on tooling: anything paid to a vendor that recurs, plus anything
   * settled on the card.
   *
   * One query with an OR rather than two summed together — a Vercel bill on
   * the card is both, and adding two counts would double it.
   *
   * The predicate is shared with the AI tools screen. Two hand-written copies
   * of "what counts as tooling" drift the first time somebody adds a vendor
   * type, and then the dashboard and the screen quietly disagree.
   */
  /*
   * A transfer OFF the prepaid card is not a purchase.
   *
   * `isToolSpend()` classifies a ROW — "does this look like tooling" — and one of
   * its two halves is "it was settled on the non-taka card", which is true of any
   * row sitting on that card, a transfer included. So moving a card top-up back
   * to the bank arrived here as tooling spend. Measured: a 30,000 transfer off
   * the card took Tools and subscriptions from 0.00 to 30,000.00, with nothing
   * bought.
   *
   * The exclusion goes HERE and not inside `isToolSpend()`, and that is the whole
   * reason this comment exists: the predicate is also read NEGATED, at
   * transactions.service.ts (`not(isToolSpend())`) to build Other expenses. Fold
   * "and it is not a transfer" into the predicate and the negation becomes "not
   * tooling OR it is a transfer", which puts every transfer straight back onto
   * the Other expenses screen — the exact complaint this all started from.
   */
  private async toolsAndSubscriptions(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(
        and(
          inPeriod(range),
          eq(transactions.direction, "out"),
          notATransfer(),
          isToolSpend(),
        ),
      );

    return Number(row.total).toFixed(2);
  }

  /** Grouped by the top-level category — thirty rows answer nothing. */
  private async byCategory(
    range: PeriodRange,
    direction: "in" | "out",
  ): Promise<CategoryLine[]> {
    const parent = sql`coalesce(${categories.parentId}, ${categories.id})`;

    const rows = await this.db.client
      .select({
        id: sql<string | null>`${parent}::text`,
        name: sql<string | null>`max(${categories.name})`,
        color: sql<string | null>`max(${categories.color})`,
        total: sql<string>`sum(${transactions.amount})::text`,
      })
      .from(transactions)
      // LEFT, so a row matching no category is kept and bucketed as
      // "Uncategorised". That is right for a genuine expense nobody has filed
      // yet, and wrong for a transfer, which has no category because it is not
      // spending at all — hence the same exclusion the totals use at
      // `periodTotals`. Measured before it was added: the dashboard's
      // spendByCategory read "Office rent 1,11,600 | Uncategorised 65,000"
      // beside a totals.moneyOut of 1,11,600, the 65,000 being one transfer
      // between two of the company's own banks. incomeByCategory carried it
      // too, so the same 65,000 was reported as both earned and spent.
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          inPeriod(range),
          notATransfer(),
          eq(transactions.direction, direction),
        ),
      )
      .groupBy(sql`1`);

    if (!rows.length) return [];

    // The heading's own name, not whichever sub-category sorted highest.
    const headings = await this.headingNames(
      rows.map((r) => r.id).filter((id): id is string => Boolean(id)),
    );

    const total = rows.reduce((sum, r) => sum + Number(r.total), 0);

    return rows
      .map((row) => {
        const heading = row.id ? headings.get(row.id) : undefined;
        return {
          id: row.id,
          name: heading?.name ?? row.name ?? "Uncategorised",
          color: heading?.color ?? row.color ?? null,
          total: Number(row.total).toFixed(2),
          share: total > 0 ? (Number(row.total) / total) * 100 : 0,
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
  }

  private async headingNames(ids: string[]) {
    if (!ids.length)
      return new Map<string, { name: string; color: string | null }>();

    const rows = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
      })
      .from(categories)
      .where(sql`${categories.id} in ${ids}`);

    return new Map(rows.map((r) => [r.id, { name: r.name, color: r.color }]));
  }

  /** Who took the most money out of the building this period. */
  private async topVendors(range: PeriodRange): Promise<OverviewVendor[]> {
    const rows = await this.db.client
      .select({
        name: vendors.name,
        total: sql<string>`sum(${transactions.amount})::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .innerJoin(vendors, eq(transactions.vendorId, vendors.id))
      .where(and(inPeriod(range), eq(transactions.direction, "out")))
      .groupBy(vendors.name)
      .orderBy(sql`sum(${transactions.amount}) desc`)
      .limit(6);

    return rows.map((row) => ({
      name: row.name,
      total: Number(row.total).toFixed(2),
      entries: Number(row.entries),
    }));
  }

  /**
   * Every account and what is in it.
   *
   * A left join and a group by, not a correlated subquery: written as a
   * subquery, both `account_id` and `id` resolve against the same table and
   * the condition is never true, which shows every account at its opening
   * balance and looks entirely plausible.
   */
  private async balances() {
    const rows = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        opening: accounts.openingBalance,
        moved: sql<string>`coalesce(sum(${transactions.signedAmount}) filter (where ${transactions.voidedAt} is null), 0)::text`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(isNull(accounts.deletedAt))
      .groupBy(
        accounts.id,
        accounts.name,
        accounts.type,
        accounts.currency,
        accounts.openingBalance,
      )
      .orderBy(accounts.name);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      balance: (Number(row.opening) + Number(row.moved)).toFixed(2),
    }));
  }

  private async recent(): Promise<OverviewEntry[]> {
    const rows = await this.db.client
      .select({
        id: transactions.id,
        refNo: transactions.refNo,
        txnDate: transactions.txnDate,
        description: transactions.description,
        direction: transactions.direction,
        amount: transactions.amount,
        categoryName: categories.name,
        vendorName: vendors.name,
        accountName: accounts.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(LIVE)
      .orderBy(desc(transactions.txnDate), desc(transactions.createdAt))
      .limit(8);

    return rows.map((row) => ({
      id: row.id,
      refNo: row.refNo,
      txnDate: row.txnDate,
      description: row.description,
      direction: row.direction,
      amount: row.amount,
      categoryName: row.categoryName,
      vendorName: row.vendorName,
      accountName: row.accountName,
    }));
  }

  private async headcount() {
    const rows = await this.db.client
      .select({
        engagement: teamMembers.engagementType,
        total: sql<number>`count(*)::int`,
      })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.status, "active"), isNull(teamMembers.deletedAt)),
      )
      .groupBy(teamMembers.engagementType);

    return {
      employees: Number(
        rows.find((r) => r.engagement === "employee")?.total ?? 0,
      ),
      contractors: Number(
        rows.find((r) => r.engagement === "contractor")?.total ?? 0,
      ),
    };
  }

  /**
   * Twelve months to the end of the period, each with its closing balance.
   *
   * One query for the movements and one for the opening position, rather than
   * twelve round trips — the running balance is then carried forward in code
   * from a single starting figure.
   */
  private async trend(endDate: string): Promise<MonthStat[]> {
    const end = monthRange(
      Number(endDate.slice(0, 4)),
      Number(endDate.slice(5, 7)),
    );

    const ranges: PeriodRange[] = [];
    let year = Number(end.start.slice(0, 4));
    let month = Number(end.start.slice(5, 7));
    for (let i = 0; i < TREND_MONTHS; i++) {
      ranges.unshift(monthRange(year, month));
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    const first = ranges[0];

    const [openingRow] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const [movedBefore] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(sql`${transactions.txnDate} < ${first.start}`, LIVE));

    const rows = await this.db.client
      .select({
        month: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`,
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      // The same exclusion the period totals use, so the PDF cannot print
      // "out 1,11,600" in its Position block and "1,76,600" for the same month
      // in the Twelve months table underneath it.
      //
      // `closingBalance` below is rolled forward as `running += in - out`, and
      // it does not move: both halves of a transfer carry the same txn_date, so
      // each month loses an equal in and out and every net is unchanged. That
      // is what makes this safe here and NOT safe in bankStats, where a single
      // account can be in scope and only one half of the pair with it.
      .where(
        and(
          gte(transactions.txnDate, first.start),
          lte(transactions.txnDate, ranges[ranges.length - 1].end),
          notATransfer(),
          LIVE,
        ),
      )
      .groupBy(sql`1`);

    const byMonth = new Map(rows.map((r) => [r.month, r]));

    let running = Number(openingRow.total) + Number(movedBefore.net);
    let previousIn: number | null = null;
    let previousOut: number | null = null;

    return ranges.map((range) => {
      const key = range.start.slice(0, 7);
      const row = byMonth.get(key);
      const moneyIn = Number(row?.moneyIn ?? 0);
      const moneyOut = Number(row?.moneyOut ?? 0);
      running += moneyIn - moneyOut;

      const stat: MonthStat = {
        year: Number(range.start.slice(0, 4)),
        month: Number(range.start.slice(5, 7)),
        label: range.label,
        moneyIn: moneyIn.toFixed(2),
        moneyOut: moneyOut.toFixed(2),
        net: (moneyIn - moneyOut).toFixed(2),
        closingBalance: running.toFixed(2),
        entries: Number(row?.entries ?? 0),
        inChange: change(previousIn, moneyIn),
        outChange: change(previousOut, moneyOut),
      };

      previousIn = moneyIn;
      previousOut = moneyOut;
      return stat;
    });
  }
}

/* -------------------------------------------------------------------------- */

function inPeriod(range: PeriodRange) {
  return and(
    gte(transactions.txnDate, range.start),
    lte(transactions.txnDate, range.end),
    LIVE,
  );
}

/** Null rather than Infinity when there was nothing to grow from. */
function change(previous: number | null, current: number): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** "118.300000" is a database column; "118.30" is a rate somebody reads. */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}
