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
  type SalaryTdsRow,
} from "@finance/shared";
import { LoaderCircle, Paperclip, Pencil, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { TabStrip } from "@/components/reports/granularity-tabs";
import { useSettings } from "@/components/settings-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { LineChallanForm } from "@/components/tax/line-challan-form";
import { TaxCalculator } from "@/components/tax/tax-calculator";
import { Card, CardHeader } from "@/components/ui/card";
import { FilterBar, FilterSelect } from "@/components/ui/filters";
import { SummaryBar } from "@/components/ui/patterns";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { tdsApi } from "@/lib/tax";

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
 *
 * The challans panel that used to sit under this table went the same way, on
 * the owner’s instruction, and its 28 rows are untouched in `tds_deposits`.
 * What replaced it is the Challan column below: the number is read against the
 * person it was deposited for, which is the question this screen is opened
 * with, rather than in a second table underneath that repeats the month.
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

/**
 * The same four in the shape `<Segmented>` reads them, in GRANULARITIES order.
 *
 * Derived rather than typed out a second time: the order the strip draws and
 * the order the API validates against are then one list, and a period added to
 * the type cannot quietly fail to appear here.
 */
const PERIOD_TABS = GRANULARITIES.map((id) => ({
  id,
  label: PERIOD_NAMES[id],
}));

/**
 * SL, Month, Employee, Salary, Tax deducted, Challan, and the payslip link.
 *
 * The month used to be drawn only when the table crossed one, which made the
 * count a variable feeding three separate spans — the empty state, the footer
 * label and the cell padding the footer out to the edge. A date column is not
 * optional, so the count is not either, and the three cannot disagree.
 */
const COLUMNS = 7;

/** Everything to the left of the tax column, which the footer label spans. */
const COLUMNS_BEFORE_TAX = 4;

export function WithholdingScreen({ initial }: { initial: SalaryTdsRegister }) {
  const { fiscalYearMode: mode } = useSettings();
  // The payslip behind the link is guarded by `payroll.read`, so a reader
  // holding `tds.read` alone is given the figures without a link that would
  // answer 403.
  const canSeePayslips = useCan("payroll.read");
  // Writing a challan number onto a salary row is a tax entry, so it follows
  // the tax permission rather than payroll’s.
  const canRecordChallans = useCan("tds.write");
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("register");
  const [granularity, setGranularity] = useState(initial.period.granularity);
  const [fiscalYear, setFiscalYear] = useState(initial.period.fiscalYear);
  const [index, setIndex] = useState(initial.period.index);

  const [register, setRegister] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The row whose challan is being written, and the one whose paper is open. */
  const [editing, setEditing] = useState<SalaryTdsRow | null>(null);
  const [viewing, setViewing] = useState<{
    lineId: string;
    challanNumber: string;
  } | null>(null);

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
   * Read the period on screen again, after something on it has changed.
   *
   * Not the effect above: that one deliberately does nothing while the filter
   * has not moved, which is exactly the case here. A challan written on one row
   * lands on every taxed row of its month, so re-reading the table is the only
   * honest way to show what the save actually did — patching the one row that
   * was edited would leave twenty-four rows on screen saying something the
   * database no longer agrees with.
   */
  async function reload() {
    try {
      setRegister(
        await tdsApi.salaryRegister({ granularity, fiscalYear, index }),
      );
    } catch {
      setError("Saved, but the table could not be read again. Reload the page.");
    }
  }

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

  return (
    <>
      <PageHeader
        title="Withholding tax"
        icon="percent"
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
          <SummaryBar
            label={`Deducted in ${register.currentMonth.label}`}
            icon="percent"
            iconTone="text-negative"
            description="The month we are in, whichever period the table shows."
            value={
              <Amount
                value={register.currentMonth.total}
                tone="neutral"
                className="text-[clamp(25px,2vw,32px)] font-semibold"
              />
            }
          />

          <FilterBar>
            <Segmented
              options={PERIOD_TABS}
              value={granularity}
              onChange={chooseGranularity}
              label="Period length"
            />

            {/* A financial year holds one yearly period, so there is nothing
                to pick between. */}
            {periods.length > 1 ? (
              <FilterSelect
                label="Period"
                // `wide` because this list is built at runtime by
                // `periodsInFiscalYear` — twelve months or four quarters, in a
                // financial-year mode this file does not decide. The widest
                // label is not something the source knows, so the control gets
                // the cap rather than the freedom to size itself to whatever it
                // is handed.
                wide
                value={String(index)}
                onChange={(next) => setIndex(Number(next))}
              >
                {/* A period that has not begun, or one that ended before the
                    books did, is greyed rather than dropped: not offered is a
                    different thing from not there. */}
                {periods.map((range, position) => (
                  <option
                    key={range.label}
                    value={String(position + 1)}
                    disabled={!isSelectable(range)}
                  >
                    {range.label}
                  </option>
                ))}
              </FilterSelect>
            ) : null}

            {/* Named rather than a bare "2026": under the July–June setting a
                financial year spans two of the years a person would name. The
                span rides in the label because a filter row carries no visible
                captions — it used to be a `title`, which said it to a mouse and
                to nobody else. */}
            <FilterSelect
              label={
                mode === "bd_july_june"
                  ? "Financial year, July to June"
                  : "Financial year, January to December"
              }
              value={String(fiscalYear)}
              onChange={(next) => chooseYear(Number(next))}
            >
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {fiscalYearLabel(year, mode)}
                </option>
              ))}
            </FilterSelect>

            {loading ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Reading {periods[index - 1]?.label ?? "that period"}…
              </span>
            ) : null}
          </FilterBar>

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
              description="Everyone on a finalised payroll run in this period who owes tax. Somebody who owed none is not listed — the total below counts them at zero either way."
            />
            <TableScroll>
              <table className="table-data min-w-224 text-sm">
                <thead>
                  <tr className="text-left">
                    <SerialHead />
                    {/*
                      The month the pay was for, which is this table's date —
                      not the period the filter above asked for. A quarter's
                      table holds three of them, and the payslip each row points
                      at is one month's.
                    */}
                    <Th width="w-32">Month</Th>
                    <Th>Employee</Th>
                    <Th align="right">Salary</Th>
                    <Th align="right">Tax deducted</Th>
                    {/*
                      The challan the tax was deposited under. One A-Challan
                      usually covers everybody in a month, so this column holds
                      the same number down a run — which is the point: an
                      employee asking which challan their tax went in under is
                      asking about their own row, and the answer used to live
                      in a second table that never mentioned them.
                    */}
                    <Th width="w-56">Challan number</Th>
                    <Th align="right" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      {/*
                        Why it is empty, rather than emptiness. A blank table
                        under a period nobody ran payroll for reads as "no tax
                        was deducted", which is a different statement about the
                        company.
                      */}
                      <td
                        colSpan={COLUMNS}
                        className="cell-prose text-center text-sm text-muted-foreground"
                      >
                        {/*
                          Two different empties, and saying the wrong one is
                          worse than saying nothing. The table holds only
                          people who owe tax, so no rows means either that no
                          run was finalised or that one was and nobody crossed
                          the threshold — and `linesInPeriod` is the count that
                          tells them apart.
                        */}
                        {register.linesInPeriod > 0 ? (
                          <>
                            <p>Nobody owed tax in {period.label}.</p>
                            <p className="mt-1">
                              <span className="num">
                                {register.linesInPeriod}
                              </span>{" "}
                              {register.linesInPeriod === 1
                                ? "person was"
                                : "people were"}{" "}
                              on the sheet and every one of them came out under
                              the threshold, so there is nothing to deposit.
                            </p>
                          </>
                        ) : (
                          <>
                            <p>No finalised payroll run in {period.label}.</p>
                            <p className="mt-1">
                              A run reaches this page once it is finalised —
                              while it is a draft its figures can still change,
                              so nothing has been deducted from anybody yet.
                            </p>
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, position) => (
                      <tr key={row.payrollLineId} className="row-finance">
                        <SerialCell n={position + 1} />
                        <td className="num text-muted-foreground">
                          {row.periodLabel}
                        </td>
                        <td>
                          <Link
                            href={`/team/${row.teamMemberId}`}
                            prefetch={false}
                            className="font-medium hover:text-primary hover:underline"
                          >
                            {row.fullName}
                          </Link>
                          {/*
                            The run is finalised, so the deduction is settled —
                            but the salary has not gone out, so nothing has
                            actually been withheld from this person yet. Shown
                            only when it is true, which is rarely.
                          */}
                          {!row.isPaid ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Salary not paid yet
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <Amount
                            value={row.grossAmount}
                            tone="neutral"
                            className="block"
                          />
                        </td>
                        <td>
                          <Amount
                            value={row.tdsAmount}
                            tone="neutral"
                            className="block font-medium"
                          />
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {row.challanNumber ? (
                              row.challanFileLineId ? (
                                /*
                                  The number is the link to the paper, which is
                                  the same gesture as an invoice number on the
                                  cash-in table — and the file it opens may
                                  hang on somebody else’s row, because a
                                  month’s challan is uploaded once.
                                */
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViewing({
                                      lineId: row.challanFileLineId!,
                                      challanNumber: row.challanNumber!,
                                    })
                                  }
                                  className="num inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-primary-text underline-offset-2 hover:underline"
                                >
                                  <Paperclip className="size-3.5" />
                                  {row.challanNumber}
                                </button>
                              ) : (
                                <span
                                  className="num text-muted-foreground"
                                  title="Nothing attached to this challan yet — the pencil adds it."
                                >
                                  {row.challanNumber}
                                </span>
                              )
                            ) : (
                              /*
                                Said in words rather than left blank. An empty
                                cell on a tax table reads as a figure that
                                failed to load; this says which of the two it
                                is.
                              */
                              <span className="text-xs text-muted-foreground">
                                Challan not recorded yet
                              </span>
                            )}

                            {canRecordChallans ? (
                              <button
                                type="button"
                                onClick={() => setEditing(row)}
                                aria-label={`Record the challan for ${row.fullName}, ${row.periodLabel}`}
                                title="Record the challan"
                                className="ml-auto cursor-pointer rounded-md p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-right">
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
                      {/* Everything to the left of the tax column, so the
                          total sits under the figures it is the total of. */}
                      <td className="font-medium" colSpan={COLUMNS_BEFORE_TAX}>
                        Deducted in {period.label}
                      </td>
                      {/*
                        The server's figure, summed in SQL across the period.
                        Adding the rows up here would be the same question put
                        to floating point, and it would answer differently.
                      */}
                      <td>
                        <Amount
                          value={register.periodTotal}
                          tone="neutral"
                          className="block font-semibold"
                        />
                      </td>
                      {/* The challan column and the payslip link, which a
                          total has nothing to say about. */}
                      <td colSpan={COLUMNS - COLUMNS_BEFORE_TAX - 1} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </TableScroll>
          </Card>

          <LineChallanForm
            // Keyed by the row, so the number in the field is the row’s own
            // rather than whichever one the drawer was opened on first.
            key={editing?.payrollLineId ?? "none"}
            open={Boolean(editing)}
            line={editing}
            /*
              Counted from the table already on screen rather than asked of the
              server: these are the rows the switch would reach, and they are
              the rows being looked at. That row's own month, not the period the
              filter named — a quarter's table holds three of them.
            */
            othersInMonth={
              editing
                ? rows.filter(
                    (other) =>
                      other.periodYear === editing.periodYear &&
                      other.periodMonth === editing.periodMonth &&
                      other.payrollLineId !== editing.payrollLineId,
                  ).length
                : 0
            }
            onClose={() => setEditing(null)}
            onSaved={async (message) => {
              toast.show(message, "success");
              await reload();
            }}
          />

          {viewing ? (
            <DocumentsDialog
              // The row that holds the file, which is not always the row that
              // was clicked — see `challanFileLineId`.
              transactionId={viewing.lineId}
              owner="payroll_line"
              kinds={["challan"]}
              title="Challan"
              refNo={viewing.challanNumber}
              onClose={() => setViewing(null)}
            />
          ) : null}
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
