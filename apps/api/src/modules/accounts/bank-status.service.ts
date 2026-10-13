import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { fromMinorUnits, monthRange, toMinorUnits } from "@finance/shared";
import { and, asc, eq, gte, isNull, lte, or, sql, type SQL } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import {
  accountMonthChecks,
  accountMonthNotes,
  accounts,
  statements,
  transactions,
  users,
} from "../../db/schema";
import { beforeBooksPeriod, inBooksPeriod } from "../transactions/books-month";
import { rowHasDollars, rowSignedDollars } from "./accounts.service";

/** A figure in both currencies. Taka is the ledger's; dollars are the rows'. */
export type BothCurrencies = { bdt: string; usd: string };

export type BankStatusRow = {
  accountId: string;
  name: string;
  bankName: string | null;
  type: string;
  currency: string;
  isActive: boolean;
  opening: BothCurrencies;
  /**
   * The month's Exchange gain less Exchange loss, already inside `opening`
   * (piece 4b): the sheet revalues a dollar account into the Opening.
   */
  revaluation: BothCurrencies;
  moneyIn: BothCurrencies;
  moneyOut: BothCurrencies;
  fee: BothCurrencies;
  closing: BothCurrencies;
  /** False when some row's dollars were read at the day's rate, or the opening had none. */
  usdExact: boolean;
  note: {
    text: string;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  /**
   * Check ticked by hand for this account and month (piece 4d), or null.
   * Check reads Matched when this is set or the month is reconciled.
   */
  check: {
    checkedAt: string;
    checkedBy: string | null;
  } | null;
};

export type BankStatus = {
  /** The books month, as its first day. */
  month: string;
  label: string;
  /** A statement covering the whole month is reconciled or audited. */
  reconciled: boolean;
  rows: BankStatusRow[];
  totals: Omit<
    BankStatusRow,
    | "accountId"
    | "name"
    | "bankName"
    | "type"
    | "currency"
    | "isActive"
    | "note"
    | "check"
  >;
};

/**
 * Accounts ▸ Bank status: the boss's BANK STATUS table, one books month at a
 * time (piece 4 of the brief of 13 Oct 2026).
 *
 * Every figure is the month an entry BELONGS to (`books-month.ts`), so May's
 * funding dated 9 June is in May's IN, and the opening is everything that
 * belongs earlier. Opening is therefore the previous month's closing by
 * construction, and Closing lands on what Accounts shows "at the end of" the
 * same month: both count a row the same way (voided rows out, nothing else).
 *
 * A revaluation (Exchange gain or loss) is folded into the Opening, as the
 * sheet shows it, and leaves IN and OUT (piece 4b). The Closing is the same
 * either way; only this page folds it.
 *
 * The dollars are each row's own, through the same expression an account's
 * own-currency balance uses (`rowSignedDollars`), never a month's taka
 * divided by one rate.
 */
@Injectable()
export class BankStatusService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async month(month: string): Promise<BankStatus> {
    const { start, end, label } = rangeOf(month);

    /* A row of the join that is a real, live entry. The LEFT JOIN gives an
       account with no entries one all-null row; `id is not null` drops it. */
    const live = sql`${transactions.id} is not null and ${transactions.voidedAt} is null`;
    const before = sql`${live} and ${beforeBooksPeriod(start)}`;
    const during = sql`${live} and ${inBooksPeriod(start, end)}`;
    const isReval = sql`${during} and ${isRevaluation}`;
    const flows = sql`${during} and not ${isRevaluation}`;
    const isIn = sql`${flows} and ${transactions.direction} = 'in'`;
    const isOut = sql`${flows} and ${transactions.direction} = 'out' and not ${isFee}`;
    const isFeeRow = sql`${flows} and ${transactions.direction} = 'out' and ${isFee}`;

    /* The stated opening counts from the month it was stated in on. */
    const opened = sql`${accounts.openingBalanceOn} <= ${end}`;

    const revalBdt = sql`coalesce(sum(${transactions.signedAmount}) filter (where ${isReval}), 0)::numeric(14,2)`;
    const openBdt = sql`(case when ${opened} then ${accounts.openingBalance} else 0 end
      + coalesce(sum(${transactions.signedAmount}) filter (where ${before}), 0)
      + ${revalBdt})::numeric(14,2)`;
    const inBdt = sql`coalesce(sum(${transactions.amount}) filter (where ${isIn}), 0)::numeric(14,2)`;
    const outBdt = sql`coalesce(sum(${transactions.amount}) filter (where ${isOut}), 0)::numeric(14,2)`;
    const feeBdt = sql`coalesce(sum(${transactions.amount}) filter (where ${isFeeRow}), 0)::numeric(14,2)`;

    /*
     * Each row's dollars to the cent BEFORE they are added. A row read at a
     * rate comes out with six decimals, and rounding each column's sum on its
     * own let May's closing and June's opening differ by a cent. Summed in
     * cents, a month's closing is the next one's opening exactly.
     */
    const usd = sql`round(${rowSignedDollars}, 2)`;
    const revalUsd = sql`coalesce(sum(${usd}) filter (where ${isReval}), 0)::numeric(14,2)`;
    const openUsd = sql`(case when ${opened} then coalesce(${accounts.openingBalanceUsd}, 0) else 0 end
      + coalesce(sum(${usd}) filter (where ${before}), 0)
      + ${revalUsd})::numeric(14,2)`;
    const inUsd = sql`coalesce(sum(${usd}) filter (where ${isIn}), 0)::numeric(14,2)`;
    /* Money out is negative in the signed dollars; the columns show it as spent. */
    const outUsd = sql`(-coalesce(sum(${usd}) filter (where ${isOut}), 0))::numeric(14,2)`;
    const feeUsd = sql`(-coalesce(sum(${usd}) filter (where ${isFeeRow}), 0))::numeric(14,2)`;

    const text = (expr: SQL) => sql<string>`(${expr})::text`;
    const closingOf = (o: SQL, i: SQL, x: SQL, f: SQL) =>
      sql<string>`(${o} + ${i} - ${x} - ${f})::text`;

    const rows = await this.db.client
      .select({
        accountId: accounts.id,
        name: accounts.name,
        bankName: accounts.bankName,
        type: accounts.type,
        currency: accounts.currency,
        isActive: accounts.isActive,
        openBdt: text(openBdt),
        revalBdt: text(revalBdt),
        inBdt: text(inBdt),
        outBdt: text(outBdt),
        feeBdt: text(feeBdt),
        closeBdt: closingOf(openBdt, inBdt, outBdt, feeBdt),
        openUsd: text(openUsd),
        revalUsd: text(revalUsd),
        inUsd: text(inUsd),
        outUsd: text(outUsd),
        feeUsd: text(feeUsd),
        closeUsd: closingOf(openUsd, inUsd, outUsd, feeUsd),
        usdExact: sql<boolean>`(
          (not ${opened} or ${accounts.openingBalanceUsd} is not null
            or ${accounts.openingBalance} = 0)
          and coalesce(bool_and(${rowHasDollars})
            filter (where ${before} or ${during}), true)
        )`,
        moved: sql<number>`count(*) filter (where ${during})::int`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(isNull(accounts.deletedAt))
      .groupBy(accounts.id)
      .orderBy(asc(accounts.sortOrder), asc(accounts.name));

    /* Every active account; an archived one only when money moved that month. */
    const shown = rows.filter((row) => row.isActive || row.moved > 0);

    const [notes, checks, reconciled] = await Promise.all([
      this.db.client
        .select({
          accountId: accountMonthNotes.accountId,
          text: accountMonthNotes.note,
          updatedAt: accountMonthNotes.updatedAt,
          updatedBy: users.fullName,
        })
        .from(accountMonthNotes)
        .leftJoin(users, eq(users.id, accountMonthNotes.updatedBy))
        .where(eq(accountMonthNotes.month, start)),
      this.db.client
        .select({
          accountId: accountMonthChecks.accountId,
          checkedAt: accountMonthChecks.checkedAt,
          checkedBy: users.fullName,
        })
        .from(accountMonthChecks)
        .leftJoin(users, eq(users.id, accountMonthChecks.checkedBy))
        .where(eq(accountMonthChecks.month, start)),
      this.isReconciled(start, end),
    ]);
    const noteOf = new Map(notes.map((note) => [note.accountId, note]));
    const checkOf = new Map(checks.map((check) => [check.accountId, check]));

    const both = (bdt: string, usd: string): BothCurrencies => ({ bdt, usd });
    const out: BankStatusRow[] = shown.map((row) => {
      const note = noteOf.get(row.accountId);
      const check = checkOf.get(row.accountId);
      return {
        accountId: row.accountId,
        name: row.name,
        bankName: row.bankName,
        type: row.type,
        currency: row.currency,
        isActive: row.isActive,
        opening: both(row.openBdt, row.openUsd),
        revaluation: both(row.revalBdt, row.revalUsd),
        moneyIn: both(row.inBdt, row.inUsd),
        moneyOut: both(row.outBdt, row.outUsd),
        fee: both(row.feeBdt, row.feeUsd),
        closing: both(row.closeBdt, row.closeUsd),
        usdExact: row.usdExact,
        note: note
          ? {
              text: note.text,
              updatedAt: note.updatedAt.toISOString(),
              updatedBy: note.updatedBy,
            }
          : null,
        check: check
          ? {
              checkedAt: check.checkedAt.toISOString(),
              checkedBy: check.checkedBy,
            }
          : null,
      };
    });

    return {
      month: start,
      label,
      reconciled,
      rows: out,
      totals: totalsOf(out),
    };
  }

  /**
   * Types, changes or clears one row's Note. Empty clears it. Audited.
   *
   * Notes are commentary on a month, not money, so a closed period does not
   * stop one: the books stay as they were, and the note says why.
   */
  async saveNote(
    input: { accountId: string; month: string; note: string },
    actor: AuthenticatedUser,
  ) {
    const { start, label } = rangeOf(input.month);
    const text = input.note.trim();

    const [account] = await this.db.client
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException("No such account");

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(accountMonthNotes)
        .where(
          and(
            eq(accountMonthNotes.accountId, account.id),
            eq(accountMonthNotes.month, start),
          ),
        )
        .limit(1);

      if (!text) {
        if (!existing) return { note: null };
        await tx
          .delete(accountMonthNotes)
          .where(eq(accountMonthNotes.id, existing.id));
        await this.audit.record(tx, {
          action: "delete",
          entityTable: "account_month_notes",
          entityId: existing.id,
          module: "accounts",
          summary: `Cleared the Bank status note for ${account.name}, ${label}`,
          before: existing,
        });
        return { note: null };
      }

      if (existing && existing.note === text) {
        return { note: { text, updatedAt: existing.updatedAt.toISOString() } };
      }

      const [saved] = existing
        ? await tx
            .update(accountMonthNotes)
            .set({ note: text, updatedBy: actor.id, updatedAt: new Date() })
            .where(eq(accountMonthNotes.id, existing.id))
            .returning()
        : await tx
            .insert(accountMonthNotes)
            .values({
              accountId: account.id,
              month: start,
              note: text,
              updatedBy: actor.id,
            })
            .returning();

      await this.audit.record(tx, {
        action: existing ? "update" : "create",
        entityTable: "account_month_notes",
        entityId: saved.id,
        module: "accounts",
        summary: `${existing ? "Changed" : "Wrote"} the Bank status note for ${account.name}, ${label}: "${text}"`,
        before: existing,
        after: saved,
      });

      return { note: { text, updatedAt: saved.updatedAt.toISOString() } };
    });
  }

  /**
   * Ticks or unticks one row's Check by hand (piece 4d). Unticking deletes the
   * hand tick only: a reconciled month still reads Matched. Audited both ways;
   * ticking what is already ticked, or unticking what is not, changes nothing.
   *
   * Like a note, a tick is the person's word that the row agrees with the
   * bank, not money, so a closed period does not stop it.
   */
  async saveCheck(
    input: { accountId: string; month: string; checked: boolean },
    actor: AuthenticatedUser,
  ) {
    const { start, label } = rangeOf(input.month);

    const [account] = await this.db.client
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!account) throw new NotFoundException("No such account");

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(accountMonthChecks)
        .where(
          and(
            eq(accountMonthChecks.accountId, account.id),
            eq(accountMonthChecks.month, start),
          ),
        )
        .limit(1);

      if (!input.checked) {
        if (!existing) return { check: null };
        await tx
          .delete(accountMonthChecks)
          .where(eq(accountMonthChecks.id, existing.id));
        await this.audit.record(tx, {
          action: "delete",
          entityTable: "account_month_checks",
          entityId: existing.id,
          module: "accounts",
          summary: `Unticked the Bank status check for ${account.name}, ${label}`,
          before: existing,
        });
        return { check: null };
      }

      if (existing) {
        return { check: await this.checkOut(tx, existing) };
      }

      const [saved] = await tx
        .insert(accountMonthChecks)
        .values({ accountId: account.id, month: start, checkedBy: actor.id })
        .returning();

      await this.audit.record(tx, {
        action: "create",
        entityTable: "account_month_checks",
        entityId: saved.id,
        module: "accounts",
        summary: `Ticked the Bank status check for ${account.name}, ${label}`,
        after: saved,
      });

      return { check: await this.checkOut(tx, saved) };
    });
  }

  /** A tick as the page reads it: when, and the name of who ticked it. */
  private async checkOut(
    tx: DbTransaction,
    check: typeof accountMonthChecks.$inferSelect,
  ) {
    const [who] = check.checkedBy
      ? await tx
          .select({ name: users.fullName })
          .from(users)
          .where(eq(users.id, check.checkedBy))
          .limit(1)
      : [];
    return {
      checkedAt: check.checkedAt.toISOString(),
      checkedBy: who?.name ?? null,
    };
  }

  /**
   * Check: whether the app has this month reconciled.
   *
   * Reconciliation is recorded per period on `statements` (Reports →
   * Statement), for the company rather than per account, so every row of a
   * month shares the answer. A statement covering the whole month counts —
   * the month's own, or a quarter or year around it.
   */
  private async isReconciled(start: string, end: string): Promise<boolean> {
    const [row] = await this.db.client
      .select({ id: statements.id })
      .from(statements)
      .where(
        and(
          isNull(statements.deletedAt),
          lte(statements.periodStart, start),
          gte(statements.periodEnd, end),
          or(eq(statements.status, "reconciled"), eq(statements.audited, true)),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}

/**
 * Fee: an out row in the Bank charges heading — the automatic charge rows
 * (`charge_for_id`) and the typed ones, the heading's children included.
 *
 * Found the way `TransactionsService.bankChargeCategoryId` finds the heading it
 * files a charge under: the slug, else the name.
 *
 * The outer coalesce is the whole of it. A transfer has no category, so
 * `category_id in (...)` is UNKNOWN for it, and `not UNKNOWN` is UNKNOWN too:
 * without it OUT dropped every transfer, and JPMorgan's May read ৳0 out.
 */
const isFee = sql`coalesce(${transactions.chargeForId} is not null
  or ${transactions.categoryId} in (
    select c.id from categories c
     where c.kind = 'out'
       and (c.slug = 'bank-charges' or c.name ilike '%bank charge%'
            or c.parent_id in (
              select p.id from categories p
               where p.kind = 'out'
                 and (p.slug = 'bank-charges' or p.name ilike '%bank charge%')))),
  false)`;

/**
 * A revaluation: a row filed under Exchange gain or Exchange loss — how the
 * app records a dollar account moved to the month's rate on the 1st. Coalesced
 * for the same reason as `isFee`: a transfer has no category.
 */
const isRevaluation = sql`coalesce(${transactions.categoryId} in (
    select c.id from categories c
     where c.slug in ('exchange-gain', 'exchange-loss')
        or c.name ilike 'exchange gain' or c.name ilike 'exchange loss'),
  false)`;

/** The 1st of a month, as its range; anything else is refused. */
function rangeOf(month: string) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(month);
  const m = match ? Number(match[2]) : 0;
  if (!match || m < 1 || m > 12) {
    throw new BadRequestException("A books month is the 1st of a month");
  }
  return monthRange(Number(match[1]), m);
}

/** The closing row, added up in paisa: exact, never floating point. */
function totalsOf(rows: BankStatusRow[]): BankStatus["totals"] {
  const sum = (
    pick: (row: BankStatusRow) => BothCurrencies,
  ): BothCurrencies => ({
    bdt: fromMinorUnits(
      rows.reduce((a, r) => a + toMinorUnits(pick(r).bdt), 0n),
    ),
    usd: fromMinorUnits(
      rows.reduce((a, r) => a + toMinorUnits(pick(r).usd), 0n),
    ),
  });
  return {
    opening: sum((r) => r.opening),
    revaluation: sum((r) => r.revaluation),
    moneyIn: sum((r) => r.moneyIn),
    moneyOut: sum((r) => r.moneyOut),
    fee: sum((r) => r.fee),
    closing: sum((r) => r.closing),
    usdExact: rows.every((r) => r.usdExact),
  };
}
