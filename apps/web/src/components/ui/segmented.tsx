"use client";

import { cn } from "@/lib/utils";

/**
 * A bordered group of chips, one of them filled lime.
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
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
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
        "inline-flex shrink-0 gap-0.5 rounded-[10px] border border-border bg-surface p-1",
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
              "cursor-pointer rounded-[7px] px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span
                className={cn(
                  "num ml-1.5 text-xs",
                  active ? "opacity-70" : "text-faint",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
