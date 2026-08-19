/**
 * How many rows a page holds, and what number the first one wears.
 *
 * Twenty, everywhere, newest first — the owner's rule. It lives here rather
 * than as a `PAGE_SIZE` in each screen because it was a `PAGE_SIZE` in each
 * screen: 50 on subscriptions, 100 on team, 200 on expenses, 24 on payroll
 * runs. None of those were page sizes. They were fetch caps, and past them the
 * screens silently stopped showing rows that exist.
 */
export const PAGE_SIZE = 20;

/**
 * The serial number of a row, counted across pages rather than within one.
 *
 * Every table wrote `index + 1`, which restarts at 1 on page 2 — so the
 * twenty-first entry is also "1", and two different rows in one table answer
 * to the same number. On a finance screen that is the number somebody reads
 * out to somebody else.
 *
 * @param page 1-based, as the API and the URL both use it.
 * @param index 0-based, as `.map()` gives it.
 */
export function serial(page: number, index: number): number {
  return (page - 1) * PAGE_SIZE + index + 1;
}

/** Pages needed to hold `total` rows — at least one, so an empty table is page 1 of 1. */
export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
