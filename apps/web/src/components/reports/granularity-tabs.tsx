"use client";

import { GRANULARITIES, type Granularity } from "@finance/shared";

import { cn } from "@/lib/utils";

/**
 * The four periods a finance document can cover, as tabs rather than a
 * dropdown.
 *
 * Both the reports screen and the statement screen had a "Granularity" select
 * offering Month / Quarter / Half year / Full year. A dropdown hides three of
 * the four choices behind a click and names the axis rather than the thing:
 * somebody looking for the quarterly report was looking for "Quarterly Finance
 * Report", not for a control called Granularity. As tabs all four are visible,
 * they are named the way the documents are named, and switching is one press.
 *
 * The two screens share this because they are the same four periods either
 * way, and a quarterly report and a quarterly statement disagreeing about what
 * a quarter is would be a bug nobody would look for.
 */
const PERIOD_NAMES: Record<Granularity, string> = {
  month: "Monthly",
  quarter: "Quarterly",
  half: "Half Year",
  year: "Yearly",
};

export function granularityTabs(kind: "Report" | "Statement") {
  return GRANULARITIES.map((granularity) => ({
    id: granularity,
    label: `${PERIOD_NAMES[granularity]} Finance ${kind}`,
    /** For a narrow rail where the full name will not fit. */
    short: PERIOD_NAMES[granularity],
  }));
}

export function TabStrip<T extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: ReadonlyArray<{ id: T; label: string; short?: string }>;
  active: T;
  onSelect: (id: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="tabs-scroll flex gap-1 border-b border-border"
    >
      {tabs.map((entry) => (
        <button
          key={entry.id}
          role="tab"
          type="button"
          aria-selected={active === entry.id}
          onClick={() => onSelect(entry.id)}
          className={cn(
            "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition",
            active === entry.id
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {/*
            The full name on a wide screen, the period alone on a narrow one.
            Four tabs each reading "Quarterly Finance Report" is 90 characters
            of tab bar, which on a phone is a horizontal scroll with the fourth
            tab permanently out of sight — and a tab you cannot see is a tab
            nobody presses.
          */}
          {entry.short ? (
            <>
              <span className="sm:hidden">{entry.short}</span>
              <span className="hidden sm:inline">{entry.label}</span>
            </>
          ) : (
            entry.label
          )}
        </button>
      ))}
    </div>
  );
}
