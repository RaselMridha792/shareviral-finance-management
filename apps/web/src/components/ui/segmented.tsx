"use client";

import { Glyph, type GlyphSource } from "@/components/ui/glyph";
import { cn } from "@/lib/utils";

/**
 * A white card of chips, one of them filled lime — the handoff's tab group.
 *
 * The design has two tab shapes and they are not interchangeable. An underline
 * row is for switching what a page *is* — Reports' four period statements,
 * Settings' eight panels — where each tab is a different document. This one is
 * for filtering what is already on screen: Active / Paused / Cancelled,
 * Current team / Past team, monthly / quarterly. Same page, narrower question.
 *
 * Written once because it had been written three times, slightly differently
 * each time — and the differences were never chosen, only accumulated.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ReadonlyArray<{
    id: T;
    label: string;
    count?: number;
    /** A Phosphor component, or a Material name (see `glyph.tsx`). */
    icon?: GlyphSource;
  }>;
  value: T;
  onChange: (next: T) => void;
  /** Names the group for a screen reader — "Subscription status". */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "sv-card inline-flex max-w-full shrink-0 flex-wrap gap-1 rounded-[11px] bg-(--sv-surface) p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-[7px] rounded-lg px-3.5 text-[13.5px] whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
              active
                ? "bg-(--sv-accent) font-extrabold text-(--sv-on-accent)"
                : "font-semibold text-(--sv-muted) hover:bg-(--sv-subtle) hover:text-(--sv-ink)",
            )}
          >
            {option.icon ? <Glyph icon={option.icon} size={17} /> : null}
            {option.label}
            {option.count === undefined ? null : (
              <span className="rounded-full bg-(--sv-subtle) px-[7px] py-px text-[11px] font-extrabold text-(--sv-muted) tabular-nums">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
