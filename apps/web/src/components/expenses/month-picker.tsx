"use client";

import { isBeforeRecords, monthRange, todayInDhaka } from "@finance/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type Range = { from: string; to: string; label: string };

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
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={beforeBooks}
        aria-label="Previous month"
        className="cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
        className="cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
