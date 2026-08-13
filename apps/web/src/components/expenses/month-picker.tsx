"use client";

import { monthRange, todayInDhaka } from "@finance/shared";
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

  function step(delta: number) {
    const raw = month - 1 + delta;
    const nextYear = year + Math.floor(raw / 12);
    const nextMonth = ((raw % 12) + 12) % 12 + 1;
    const next = monthRange(nextYear, nextMonth);
    onChange({ from: next.start, to: next.end, label: next.label });
  }

  const today = todayInDhaka();
  const isCurrent = today >= range.from && today <= range.to;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label="Previous month"
        className="cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
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
