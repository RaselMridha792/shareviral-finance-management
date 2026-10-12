import { BadRequestException } from "@nestjs/common";
import { BOOKS_MONTH_LATER_MESSAGE } from "@finance/shared";

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
