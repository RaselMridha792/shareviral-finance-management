"use client";

import {
  GRANULARITIES,
  RECORDS_START,
  currentFiscalYear,
  fiscalYearLabel,
  fiscalYearOf,
  isWithin,
  isoDate,
  periodsInFiscalYear,
  todayInDhaka,
  type FiscalYearMode,
  type Granularity,
  type PeriodRange,
  type SalaryTdsRegister,
} from "@finance/shared";
import { LoaderCircle, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { TabStrip } from "@/components/reports/granularity-tabs";
import { useSettings } from "@/components/settings-provider";
import { TaxCalculator } from "@/components/tax/tax-calculator";
import { Card, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { tdsApi } from "@/lib/tax";
import { cn } from "@/lib/utils";

/**
 * Who was taxed this period, and how much — and nothing else.
 *
 * The screen used to carry three summary cards, a month-by-month liability
 * table, the challans, the quarterly returns and a form for each. The owner cut
 * it to one card, one table and a calculator: every deduction here comes off a
 * salary, so the useful question is whose salary and how much, and the answer
 * to that is a list of people rather than a grid of totals.
 *
 * What left the screen did not leave the app. `/tds/deposits`, `/tds/liability`
 * and `/tds/returns` still answer, `tdsApi` still calls them, and the challans
 * and returns are still recorded — they are the compliance trail, and they are
 * one `git show` away from a page of their own. Same treatment income tax and
 * the retired reports got.
 */
const TABS = [
  { id: "register", label: "Salary deductions" },
  { id: "calculator", label: "Tax calculator" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/**
 * The four periods, named the way the owner asked for them.
 *
 * The reports and statement screens name the same four after the document
 * ("Quarterly Finance Report"). Here the period is a filter over one table, so
 * it is named as a period and nothing more.
 */
const PERIOD_NAMES: Record<Granularity, string> = {
  month: "Monthly",
  quarter: "Quarterly",
  half: "Half year",
  year: "Yearly",
};

const th =
  "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const thRight = `${th} text-right`;

export function WithholdingScreen({ initial }: { initial: SalaryTdsRegister }) {
  const { fiscalYearMode: mode } = useSettings();
  // The payslip behind the link is guarded by `payroll.read`, so a reader
  // holding `tds.read` alone is given the figures without a link that would
  // answer 403.
  const canSeePayslips = useCan("payroll.read");

  const [tab, setTab] = useState<Tab>("register");
  const [granularity, setGranularity] = useState(initial.period.granularity);
  const [fiscalYear, setFiscalYear] = useState(initial.period.fiscalYear);
  const [index, setIndex] = useState(initial.period.index);

  const [register, setRegister] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => selectableFiscalYears(mode), [mode]);
  const periods = useMemo(
    () => periodsInFiscalYear(fiscalYear, mode, granularity),
    [fiscalYear, mode, granularity],
  );

  /**
   * The period already on the screen.
   *
   * A ref rather than a comparison against `register.period`, so the effect
   * below can tell "the filter moved" from "the page has just loaded". The
   * server rendered the first period; asking for it again on mount would be a
   * wasted request and a loader flashing over figures that are already right.
   */
  const shown = useRef(periodKey(initial.period));

  useEffect(() => {
    const wanted = periodKey({ granularity, fiscalYear, index });
    if (wanted === shown.current) return;
    shown.current = wanted;

    let live = true;
    // Cleared before the request rather than after it: a failure on one period
    // must not leave its red banner sitting over a period that read perfectly
    // well.
    setLoading(true);
    setError(null);
    tdsApi
      .salaryRegister({ granularity, fiscalYear, index })
      .then((next) => {
        if (live) setRegister(next);
      })
      .catch((caught) => {
        if (!live) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Could not read that period.",
        );
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [granularity, fiscalYear, index]);

  /**
   * Keep the reader where they were in the year.
   *
   * Switching August to Quarterly lands on the quarter August sits in, not on
   * the first quarter of a year nobody was looking at. Carrying the index
   * across untouched would be worse than surprising: the API cross-checks it
   * against the granularity, so month 9 asked for as a quarter is a 400 rather
   * than a shrug.
   */
  function chooseGranularity(next: Granularity) {
    const anchor = periods[index - 1]?.start ?? todayInDhaka();
    const list = periodsInFiscalYear(fiscalYear, mode, next);
    const found = list.findIndex((range) => isWithin(anchor, range));

    setGranularity(next);
    setIndex(nearestSelectable(list, found >= 0 ? found + 1 : 1));
  }

  /**
   * The same period of another year may not be there to look at: June of this
   * financial year has not happened, and June of the one before it ended before
   * the books opened. `nearestSelectableMonth` does this for the month pickers;
   * a period picker needs it for the same reason.
   */
  function chooseYear(next: number) {
    setFiscalYear(next);
    setIndex(
      nearestSelectable(periodsInFiscalYear(next, mode, granularity), index),
    );
  }

  const period = register.period;
  const rows = register.rows;
  /**
   * The month column earns its place only when the table crosses one. A column
   * repeating "August 2026" on every row of an August table says nothing.
   */
  const showMonth =
    new Set(rows.map((row) => `${row.periodYear}-${row.periodMonth}`)).size > 1;
  const columns = showMonth ? 5 : 4;

  return (
    <>
      <PageHeader
        title="Withholding tax"
        description="Tax deducted from salaries — whose, and how much."
      />

      <TabStrip
        tabs={TABS}
        active={tab}
        onSelect={setTab}
        label="Withholding tax"
      />

      {tab === "calculator" ? (
        <TaxCalculator years={years} mode={mode} />
      ) : (
        <>
          {/*
            One card, and deliberately above the filter rather than beside the
            table: it always shows the calendar month we are in, whatever period
            is being read below. Sitting inside the filtered block it would read
            as a figure the filter had produced.
          */}
          <Card className="flex max-w-xs flex-col gap-1 px-4 py-3.5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Deducted in {register.currentMonth.label}
            </span>
            <Amount
              value={register.currentMonth.total}
              tone="neutral"
              className="text-xl font-medium"
            />
            <span className="text-xs text-muted-foreground">
              The month we are in, whichever period the table shows.
            </span>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {GRANULARITIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={granularity === option}
                  onClick={() => chooseGranularity(option)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition",
                    granularity === option
                      ? "bg-primary text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PERIOD_NAMES[option]}
                </button>
              ))}
            </div>

            {/* A financial year holds one yearly period, so there is nothing
                to pick between. */}
            {periods.length > 1 ? (
              <Select
                aria-label="Period"
                className="h-9 w-40"
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
              >
                {/* A period that has not begun, or one that ended before the
                    books did, is greyed rather than dropped: not offered is a
                    different thing from not there. */}
                {periods.map((range, position) => (
                  <option
                    key={range.label}
                    value={position + 1}
                    disabled={!isSelectable(range)}
                  >
                    {range.label}
                  </option>
                ))}
              </Select>
            ) : null}

            {/* Named rather than a bare "2026": under the July–June setting a
                financial year spans two of the years a person would name. */}
            <Select
              aria-label="Financial year"
              title={
                mode === "bd_july_june" ? "July to June" : "January to December"
              }
              className="h-9 w-auto"
              value={fiscalYear}
              onChange={(event) => chooseYear(Number(event.target.value))}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {fiscalYearLabel(year, mode)}
                </option>
              ))}
            </Select>

            {loading ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Reading {periods[index - 1]?.label ?? "that period"}…
              </span>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {error}
            </p>
          ) : null}

          <Card className="overflow-hidden">
            <CardHeader
              title={period.label}
              description="Everyone on a finalised payroll run in this period. Somebody who owed no tax is listed at 0.00 rather than left out — this is who was paid, not only who was taxed."
            />
            <div className="overflow-x-auto">
              <table className="table-data min-w-160 text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left">
                    <th className={th}>Employee</th>
                    {showMonth ? <th className={th}>Month</th> : null}
                    <th className={thRight}>Salary</th>
                    <th className={thRight}>Tax deducted</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.length === 0 ? (
                    <tr>
                      {/*
                        Why it is empty, rather than emptiness. A blank table
                        under a period nobody ran payroll for reads as "no tax
                        was deducted", which is a different statement about the
                        company.
                      */}
                      <td
                        colSpan={columns}
                        className="cell-prose px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        <p>No finalised payroll run in {period.label}.</p>
                        <p className="mt-1">
                          A run reaches this page once it is finalised — while
                          it is a draft its figures can still change, so nothing
                          has been deducted from anybody yet.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        key={row.payrollLineId}
                        className="row-finance hover:bg-surface-muted/50"
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {row.fullName}
                          {/*
                            The run is finalised, so the deduction is settled —
                            but the salary has not gone out, so nothing has
                            actually been withheld from this person yet. Shown
                            only when it is true, which is rarely.
                          */}
                          {!row.isPaid ? (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              Salary not paid yet
                            </span>
                          ) : null}
                        </td>
                        {showMonth ? (
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {row.periodLabel}
                          </td>
                        ) : null}
                        <td className="px-4 py-2.5">
                          <Amount
                            value={row.grossAmount}
                            tone="neutral"
                            className="block"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <Amount
                            value={row.tdsAmount}
                            tone="neutral"
                            className="block font-medium"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canSeePayslips ? (
                            <Link
                              href={`/payroll/${row.payrollLineId}/payslip`}
                              prefetch={false}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Printer className="size-3" />
                              Payslip
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 ? (
                  <tfoot>
                    <tr className="border-t border-border bg-surface-muted/40">
                      <td
                        className="px-4 py-2.5 font-medium"
                        colSpan={showMonth ? 3 : 2}
                      >
                        Deducted in {period.label}
                      </td>
                      {/*
                        The server's figure, summed in SQL across the period.
                        Adding the rows up here would be the same question put
                        to floating point, and it would answer differently.
                      */}
                      <td className="px-4 py-2.5">
                        <Amount
                          value={register.periodTotal}
                          tone="neutral"
                          className="block font-semibold"
                        />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/** The three fields that decide which period is being read. */
function periodKey(period: {
  granularity: Granularity;
  fiscalYear: number;
  index: number;
}): string {
  return `${period.granularity}:${period.fiscalYear}:${period.index}`;
}

/**
 * A period the app can show figures for: one that has begun, and one that had
 * not already ended when the books opened.
 *
 * The same test `/reports/periods` applies server-side. It is repeated here
 * rather than fetched because that endpoint is guarded by `reports.view` and
 * this screen by `tds.read` — a reader holding the tax permission and not the
 * reports one must still get a working picker.
 */
function isSelectable(range: PeriodRange): boolean {
  const booksOpen = isoDate(RECORDS_START.year, RECORDS_START.month, 1);
  return range.start <= todayInDhaka() && range.end >= booksOpen;
}

/** The wanted period if it can be shown, else the latest one that can. */
function nearestSelectable(periods: PeriodRange[], wanted: number): number {
  if (periods[wanted - 1] && isSelectable(periods[wanted - 1])) return wanted;
  for (let position = periods.length; position >= 1; position--) {
    if (isSelectable(periods[position - 1])) return position;
  }
  return 1;
}

/**
 * Every financial year the picker may offer: the one the books opened in, up to
 * the one we are in, newest first. In July–June mode, books opening in May 2026
 * makes the first of them FY 2025-26.
 */
function selectableFiscalYears(mode: FiscalYearMode): number[] {
  const first = fiscalYearOf(
    isoDate(RECORDS_START.year, RECORDS_START.month, 1),
    mode,
  );
  const years: number[] = [];
  for (let year = currentFiscalYear(mode); year >= first; year--) {
    years.push(year);
  }
  return years;
}
