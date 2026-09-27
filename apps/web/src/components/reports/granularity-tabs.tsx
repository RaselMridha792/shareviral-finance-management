"use client";

import { GRANULARITIES, type Granularity } from "@finance/shared";

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
