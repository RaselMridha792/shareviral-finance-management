"use client";

import { isBeforeRecords, monthRange, todayInDhaka } from "@finance/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type Range = { from: string; to: string; label: string };

/**
 * The two arrows, drawn to the filter row's measurements.
 *
 * This control shares a row with <DateRangeField> and <FilterSelect>, and
 * those are 40px tall with a filled, bordered box. Written as `p-2` around a
 * 16px icon these arrows came out 34px, and six pixels is exactly the size of
 * mismatch that reads as a mistake without anyone being able to say which of
 * the two heights is the wrong one. So: h-10, rounded-lg, border-border,
 * bg-surface-muted, the same four as `controlClass`.
 *
 * `size-10` rather than `h-10 w-10` because the arrows should be square — a
 * stepper's two ends are the same shape, and padding alone does not promise
 * that once the height is fixed.
 *
 * The hover has to move the other way now. It used to fill in from nothing to
 * `bg-surface-muted`; with muted as the resting state it lifts to `bg-surface`
 * instead, which is the same move the inputs make when they take focus — up in
 * light, down in dark, a change either way. `enabled:` so the arrow at the end
 * of the road stays put under the pointer, rather than promising a click it
 * will not take.
 */
const arrowClass =
  "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg " +
  "border border-border bg-surface-muted text-muted-foreground transition " +
  "enabled:hover:bg-surface enabled:hover:text-foreground " +
  "focus-visible:border-primary focus-visible:bg-surface " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Month stepper. Records run on calendar months, so this moves one month at a
 * time rather than offering a free date range — the common case in one click.
 */
export function MonthPicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (next: Range) => void;
}) {
  const year = Number(range.from.slice(0, 4));
  const month = Number(range.from.slice(5, 7));

  function stepped(delta: number) {
    const raw = month - 1 + delta;
    return {
      year: year + Math.floor(raw / 12),
      month: (((raw % 12) + 12) % 12) + 1,
    };
  }

  function step(delta: number) {
    const target = stepped(delta);
    const next = monthRange(target.year, target.month);
    onChange({ from: next.start, to: next.end, label: next.label });
  }

  const today = todayInDhaka();
  const isCurrent = today >= range.from && today <= range.to;

  // The other end of the stepper, which was missing. Forward already stopped at
  // the running month; back would walk into 2025 and further, and every month
  // out there shows a page of zeroes that reads as "nothing was spent" rather
  // than "the company did not exist yet".
  const back = stepped(-1);
  const beforeBooks = isBeforeRecords(back.year, back.month);

  return (
    // h-10 on the row as well as on the arrows: the month name is bare text
    // with no box of its own, and stating the height here is what keeps it on
    // the centre line of the controls beside it rather than on the centre line
    // of its own line-height.
    <div className="flex h-10 shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={beforeBooks}
        aria-label="Previous month"
        className={arrowClass}
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 px-2 text-center text-sm font-medium">
        {range.label}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={isCurrent}
        aria-label="Next month"
        className={arrowClass}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
