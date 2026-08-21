"use client";

import { isBeforeRecords, monthRange, todayInDhaka } from "@finance/shared";
import { useMemo } from "react";

import { Select } from "@/components/ui/field";

export type Range = { from: string; to: string; label: string };

/**
 * Every month the books cover, newest first.
 *
 * Built rather than fixed at twelve, and that is what lets the list carry no
 * greyed rows: a January–December list has to show September to say September
 * exists, but a list assembled from the months that have actually happened has
 * nothing to explain. It ends at this month because the next one has not been
 * spent yet, and it ends at `RECORDS_START` going back because before that the
 * company's books do not exist — every month out there is a page of zeroes
 * that reads as "nothing was spent" rather than "there was nothing to spend".
 *
 * One row a month, so it grows on its own and needs nothing done to it.
 */
function monthsInBooks(): Range[] {
  const today = todayInDhaka();
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));

  const months: Range[] = [];
  while (!isBeforeRecords(year, month)) {
    const range = monthRange(year, month);
    months.push({ from: range.start, to: range.end, label: range.label });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/**
 * Which month a screen is showing, as a list rather than two arrows.
 *
 * It was `‹ August 2026 ›`, which is one click to last month and eleven to
 * last September — and no way to see, without clicking, how far back the books
 * go. The owner asked for the dropdown. Records still run on calendar months,
 * so this offers months and not a free date range: the common case stays one
 * gesture, and no screen has to explain what a half-month total means.
 *
 * A native `<select>` on purpose. It is the app's own `Select`, so it carries
 * the same border, height and lime focus ring as every other control in a
 * filter row, and on a phone it opens the operating system's own wheel rather
 * than a list this app would have to teach to scroll.
 */
export function MonthPicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (next: Range) => void;
}) {
  const months = useMemo(() => monthsInBooks(), []);

  /*
   * The month a URL asked for, even when it is not one of ours.
   *
   * `?from=2027-01-01` typed by hand, or a bookmark from a month that has
   * since scrolled out of the books, would otherwise leave the select showing
   * the first option while the page below it showed something else — a control
   * quietly lying about what is on screen. Carrying the odd month as its own
   * row keeps the two honest; picking anything else leaves it behind.
   */
  const known = months.some((month) => month.from === range.from);
  const options = known ? months : [range, ...months];

  return (
    <Select
      aria-label="Month"
      className="w-auto shrink-0 font-medium"
      value={range.from}
      onChange={(event) => {
        const picked = options.find(
          (month) => month.from === event.target.value,
        );
        if (picked) onChange(picked);
      }}
    >
      {options.map((month) => (
        <option key={month.from} value={month.from}>
          {month.label}
        </option>
      ))}
    </Select>
  );
}
