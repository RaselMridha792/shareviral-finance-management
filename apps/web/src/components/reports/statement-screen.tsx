"use client";

import type { FinancialStatement, Granularity } from "@finance/shared";
import { useState } from "react";

import {
  TabStrip,
  granularityTabs,
} from "@/components/reports/granularity-tabs";
import { StatementView } from "@/components/reports/statement-view";
import { PageHeader } from "@/components/ui/page-header";
import type { AvailablePeriods } from "@/lib/reports";

const TABS = granularityTabs("Statement");

/**
 * The signed document, on its own screen.
 *
 * It was the fourth tab on Reports, and it did not belong there. The others are
 * reports — figures laid out to be read, and re-read at whatever length suits
 * the question. This is a *statement*: a position reconciled to a closing
 * balance, with notes, a status and a signature block, and it is the file that
 * leaves the company. Filing it beside three reports made the one document
 * somebody signs look like a fourth way of slicing the same numbers.
 *
 * Four periods, same four as the reports, named the way the documents are
 * named. `key` on the view is what makes switching honest: the statement holds
 * edited notes, a status and signatories, and carrying those across from the
 * quarterly to the yearly would silently attach one period's sign-off to
 * another's figures.
 */
export function StatementScreen({
  initialStatement,
  initialPeriods,
  initialIndex,
}: {
  /** Null when the statement endpoint could not answer. */
  initialStatement: FinancialStatement | null;
  initialPeriods: AvailablePeriods;
  initialIndex: number;
}) {
  const [granularity, setGranularity] = useState<Granularity>("month");

  return (
    <>
      <PageHeader
        title="Reports"
        icon="bar_chart"
        description="The reconciled position for a period, with its notes and who signed it off."
      />

      <TabStrip
        tabs={TABS}
        active={granularity}
        onSelect={setGranularity}
        label="Reports"
      />

      <StatementView
        key={granularity}
        granularity={granularity}
        // Only the monthly tab opens on the figures the server already
        // fetched. The others are a different period, so handing them these
        // would show one length's numbers under another's heading until the
        // fetch returned.
        initialStatement={granularity === "month" ? initialStatement : null}
        initialPeriods={initialPeriods}
        initialFiscalYear={initialPeriods.years[1]}
        initialIndex={initialIndex}
      />
    </>
  );
}
