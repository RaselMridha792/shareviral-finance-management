"use client";

import type { FinancialStatement, Granularity } from "@finance/shared";
import { useState } from "react";

import { granularityTabs } from "@/components/reports/granularity-tabs";
import { Select } from "@/components/ui/field";
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

      {/*
        One tab, and the period beside it in a select.

        It was four tabs — "Monthly Finance Statement", "Quarterly Finance
        Statement", and so on — which is the same three words written four
        times, and 90 characters of tab bar for one choice. The tab stays
        rather than disappearing because it is the row another statement would
        join; the choice it used to carry is now a control that says what it
        is choosing.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <span
          role="tab"
          aria-selected="true"
          className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-primary"
        >
          Finance Statement
        </span>
        <Select
          aria-label="Period"
          className="mb-2 h-9 w-auto"
          value={granularity}
          onChange={(event) =>
            setGranularity(event.target.value as Granularity)
          }
        >
          {TABS.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.short ?? tab.label}
            </option>
          ))}
        </Select>
      </div>

      <StatementView
        key={granularity}
        granularity={granularity}
        // Only the monthly tab opens on the figures the server already
        // fetched. The others are a different period, so handing them these
        // would show one length's numbers under another's heading until the
        // fetch returned.
        initialStatement={granularity === "month" ? initialStatement : null}
        initialPeriods={initialPeriods}
        /*
         * The year the periods belong to, and the same one the server asked
         * for. This was `years[1]` — one behind — so whatever the page had
         * fetched, the view immediately re-fetched last year's month and every
         * visit opened on an empty statement.
         *
         * `Math.max`, not an index: the order of that list is not this file's
         * to know, and an index is only right while the order is.
         */
        initialFiscalYear={Math.max(...initialPeriods.years)}
        initialIndex={initialIndex}
      />
    </>
  );
}
