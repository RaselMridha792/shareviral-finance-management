"use client";

import type { ReactNode } from "react";

import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * The filter row, and the two controls that were only ever drawn properly
 * once.
 *
 * Filtering exists on nine screens and each drew its own: a select here, a
 * date pair there, captions stacked above the inputs on a third. They were not
 * different because anybody chose differently — they were written at different
 * times, and the differences accumulated.
 *
 * The one that had been thought about is Transactions', and the thinking is
 * worth keeping rather than re-deriving: the two dates are a single bordered
 * control because the rule between them is what says they are the ends of a
 * range; the selects are content-sized only where the options are known and
 * capped where they are not; and the search box is the one control allowed to
 * grow, because it is the only one whose content has no length limit.
 */

/**
 * One row, wrapping.
 *
 * `items-center` and a 8px gap, which is what makes a select, a date pair and
 * a search box sit on one line and look deliberate rather than assembled.
 */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

/**
 * From and to, as one control.
 *
 * Two separate bordered boxes read as two unrelated dates. One box with a
 * hairline between them reads as a range, and it is worth about thirty pixels
 * of the row — which on a laptop is the difference between this fitting on one
 * line and not.
 *
 * The labels are on the inputs rather than above them: a caption stacked over
 * each is what made this two rows in the first place, and a date input ignores
 * a placeholder, so `aria-label` names each end for a screen reader and
 * `title` says the same to a mouse.
 *
 * 13px, not the app's usual 15: the browser sizes a date field to whatever
 * "mm/dd/yyyy" and its picker button need, and no width of ours makes it
 * smaller without cutting the year off. What it does answer to is type size —
 * the pair asks for 234px at 13px against 266px at 15px. Digits in a mono face
 * carry the smaller size without complaint.
 */
export function DateRangeField({
  from,
  to,
  onChange,
  fromLabel = "From date",
  toLabel = "To date",
}: {
  from?: string;
  to?: string;
  onChange: (next: { from?: string; to?: string }) => void;
  fromLabel?: string;
  toLabel?: string;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-muted px-2 text-xs transition focus-within:border-primary focus-within:bg-surface">
      <input
        type="date"
        aria-label={fromLabel}
        title={fromLabel}
        value={from ?? ""}
        onChange={(event) =>
          onChange({ from: event.target.value || undefined, to })
        }
        className="num w-auto bg-transparent outline-none"
      />
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      <input
        type="date"
        aria-label={toLabel}
        title={toLabel}
        value={to ?? ""}
        onChange={(event) =>
          onChange({ from, to: event.target.value || undefined })
        }
        className="num w-auto bg-transparent outline-none"
      />
    </div>
  );
}

/**
 * A select in a filter row.
 *
 * `wide` is the choice worth making per use. Without it the control sizes to
 * its widest option, which is right when the options are written out in the
 * source and known — three directions, four periods. With a list that comes
 * from the database it is wrong: one account named after its bank and its
 * branch number sizes the control to itself and takes the room out of the
 * search box. So a list from data gets a cap, and the browser ellipsises the
 * long name, which is the right thing to lose.
 */
export function FilterSelect({
  label,
  value,
  onChange,
  wide = false,
  children,
}: {
  /** Named for a screen reader; the row has no visible captions by design. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /** True when the options come from the database rather than from source. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(controlClass, "w-auto shrink-0", wide && "max-w-34")}
    >
      {children}
    </select>
  );
}
