import { BadRequestException } from "@nestjs/common";
import { BOOKS_MONTH_LATER_MESSAGE } from "@finance/shared";
import { sql, type SQL } from "drizzle-orm";

import { transactions } from "../../db/schema/transactions";

/**
 * The month an entry belongs to — what a row STORES, worked out once.
 *
 * `books_month` is null for an entry that belongs to the month of its date,
 * which is nearly every entry; only one that belongs elsewhere carries a
 * value (the brief of 13 Oct 2026). So a month chosen on a form that happens
 * to be the date's own is stored as null, and two rows that mean the same
 * thing never look different in the table.
 *
 * Earlier months only. A later one is refused with the brief's sentence —
 * prepayments are the case that would need it, and the owner widens the rule
 * when he wants them, here and nowhere else.
 */
export function storedBooksMonth(
  txnDate: string,
  booksMonth: string | null | undefined,
): string | null {
  if (!booksMonth) return null;
  const own = monthOf(txnDate);
  if (booksMonth > own) {
    throw new BadRequestException({
      message: BOOKS_MONTH_LATER_MESSAGE,
      errors: { booksMonth: [BOOKS_MONTH_LATER_MESSAGE] },
    });
  }
  return booksMonth === own ? null : booksMonth;
}

/** The 1st of the month `date` falls in, as an ISO date. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * What the Assistant's map says about the field, on every form that has it.
 * One wording, so the Assistant hears the same rule from every door.
 */
export const BOOKS_MONTH_MEANS =
  "the month's books it belongs to, as the 1st (2026-05-01), when not the month of txnDate: May's bill paid 12 June. Never a later month than the date's; leave it out for the date's own month";

/* -------------------------------------------------------------------------- */
/*  Reading it: every month view asks here, and nowhere else                   */
/* -------------------------------------------------------------------------- */

/**
 * The month an entry belongs to, in SQL — the one copy of the rule.
 *
 * `books_month` when the entry carries one, the month of its date otherwise.
 * Every screen that answers "how much in month X" groups and filters by this
 * (piece 3 of the brief of 13 Oct 2026). The boss closed May's books in June,
 * so the funding dated 9 June and marked May is May's money on the Dashboard,
 * on Accounts, on Expenses and on the Statement.
 *
 * What is about a DAY does not read it, on purpose: the overdraft rule, the
 * bank statement's running balance (`/statement`), reconciliation, TDS,
 * `fx.service.ts` and the date filter on All transactions all stay on
 * `txn_date`.
 */
export const booksMonthSql: SQL<string> = sql<string>`coalesce(${transactions.booksMonth}, date_trunc('month', ${transactions.txnDate})::date)`;

/**
 * The rows that belong to the window `from`..`to`.
 *
 * For a whole-month window (every month view's: the 1st to the last day) this
 * is exactly `booksMonthSql between from and to`. The second half is there for
 * a window that starts or ends mid-month — the Assistant's look-ups take any
 * two dates — so that an entry with no books month is judged by its date
 * precisely as it was before. A marked entry is in the window when its month
 * is.
 */
export function inBooksPeriod(from: string, to: string): SQL {
  return sql`(${booksMonthSql} between ${monthOf(from)} and ${to}
    and (${transactions.booksMonth} is not null
         or ${transactions.txnDate} between ${from} and ${to}))`;
}

/**
 * The rows that belong before `day` — what a window starting there opens on.
 *
 * A month's opening is the account's opening balance plus every entry whose
 * books month is earlier (the brief). Unmarked rows are judged by their date,
 * so a mid-month `day` still counts them to the day, as before.
 */
export function beforeBooksPeriod(day: string): SQL {
  return sql`(${booksMonthSql} < ${monthOf(day)}
    or (${transactions.booksMonth} is null
        and ${transactions.txnDate} < ${day}))`;
}

/**
 * The rows that belong on or before `day` — "as at the end of that day".
 *
 * The complement of `beforeBooksPeriod` for the day after, written out so a
 * caller holding a month's last day does not have to add one.
 */
export function upToBooksPeriod(day: string): SQL {
  return sql`(${booksMonthSql} < ${monthOf(day)}
    or (${transactions.booksMonth} is not null
        and ${booksMonthSql} = ${monthOf(day)})
    or ${transactions.txnDate} <= ${day})`;
}
