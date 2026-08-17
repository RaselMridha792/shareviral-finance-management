"use client";

import {
  formatMoney,
  type FinancialStatement,
  type Granularity,
  type Money2,
  type StatementSignatory,
} from "@finance/shared";
import {
  CircleCheck,
  FileDown,
  FileWarning,
  Info,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CategoryDonut } from "@/components/charts/category-donut";
import { WaterfallChart } from "@/components/charts/waterfall-chart";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/components/settings-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useCan } from "@/components/auth/session-provider";
import { ApiError } from "@/lib/api-client";
import { exportUrl } from "@/lib/ledger";
import { reportsApi, type AvailablePeriods } from "@/lib/reports";
import { cn } from "@/lib/utils";

/**
 * The statement, on screen.
 *
 * This is the six-page document the company used to assemble by hand, section
 * for section and in the same order — because the order is the argument. It
 * opens with where the period closed, then what that closing balance is really
 * made of, then how it got there, then every line behind it. A reader who
 * stops after the first card has still read the answer.
 *
 * Every figure carries both currencies. Elsewhere in this app dollars are a
 * view you switch to, so a translated number is never mistaken for a recorded
 * one; here they sit together because two finance teams read the same page. The
 * distinction survives instead in the marking: a dollar figure translated after
 * the fact is prefixed with ≈ and greyed, and one with no rate at all is a
 * blank rather than a guess.
 */

const CHART_COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const th =
  "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const thRight = `${th} text-right`;

/**
 * Rates are stored with six decimals. Two is what a person reads; the rest
 * only appear when the rate genuinely carries them, so "118.750000" shows as
 * ৳118.75 and a real ৳118.7513 keeps its tail.
 */
function formatRate(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const [whole, fraction = ""] = parsed
    .toFixed(6)
    .replace(/0+$/, "")
    .split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  Figures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The dollar line under a taka figure.
 *
 * Three states, and they must not look alike: recorded (the rate was captured
 * on the entry), estimated (a period rate was applied afterwards — marked ≈),
 * and absent (no rate at all — an em dash, never a zero). The whole reason the
 * rate lives on the entry rather than the period is that this company's bank
 * moved at ৳122.77 and its prepaid card at ৳123.00 inside the same month.
 *
 * Dollars are grouped the western way even when the app is set to Bangladeshi
 * grouping: $1,02,345 is not a dollar figure any American reader recognises,
 * and this is the one page written for both.
 */
function UsdLine({ value, className }: { value: Money2; className?: string }) {
  if (!value.usd) {
    return (
      <span
        className={cn("col-amount block text-muted-foreground", className)}
        title="No exchange rate was recorded against this entry, so there is no dollar figure. A blank is honest; a number produced from whatever rate was lying around is not."
      >
        —
      </span>
    );
  }

  const text = formatMoney(value.usd, { currency: "USD", format: "western" });

  if (value.estimated) {
    return (
      <span
        className={cn(
          "col-amount block text-muted-foreground italic underline decoration-dotted underline-offset-2",
          className,
        )}
        title={`Translated${value.rate ? ` at ৳${formatRate(value.rate)}` : ""} after the fact — this entry carried no rate of its own. Not a recorded figure.`}
      >
        ≈ {text}
      </span>
    );
  }

  return (
    <span
      className={cn("col-amount block text-muted-foreground", className)}
      title={
        value.rate
          ? `Recorded at ৳${formatRate(value.rate)} on the day`
          : undefined
      }
    >
      {text}
    </span>
  );
}

/** Taka above, dollars beneath. The unit of this document. */
function MoneyPair({
  value,
  size = "sm",
  tone = "neutral",
  strong,
}: {
  value: Money2;
  size?: "sm" | "lg" | "xl";
  tone?: "auto" | "neutral" | "in" | "out";
  strong?: boolean;
}) {
  return (
    <span className="flex flex-col items-end">
      {/* MoneyPair renders the dollar line itself, from the entry's own
          recorded rate rather than today's. */}
      <Amount
        value={value.bdt}
        currency="BDT"
        tone={tone}
        showCounterpart={false}
        className={cn(
          "block",
          size === "xl" && "text-2xl font-semibold tracking-tight",
          size === "lg" && "text-base font-semibold",
          size === "sm" && "text-sm",
          strong && "font-semibold",
        )}
      />
      <UsdLine
        value={value}
        className={size === "xl" ? "mt-1 text-sm" : "text-xs"}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export function StatementView({
  granularity,
  initialStatement,
  initialPeriods,
  initialFiscalYear,
  initialIndex,
}: {
  /**
   * How long a period this statement covers.
   *
   * A prop now rather than a select inside this component: the screen above
   * chooses it with a tab per length, and a dropdown in here saying the same
   * thing would be a second control for one decision — the kind that ends up
   * disagreeing with the tab it sits under.
   */
  granularity: Granularity;
  initialStatement: FinancialStatement | null;
  initialPeriods: AvailablePeriods;
  initialFiscalYear: number;
  initialIndex: number;
}) {
  // Grouping follows the company's setting — ৳12,50,000 or ৳1,250,000.
  const { numberFormat: format } = useSettings();
  const [periods, setPeriods] = useState(initialPeriods);
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear);
  const [index, setIndex] = useState(initialIndex);

  const [statement, setStatement] = useState<FinancialStatement>(
    initialStatement ?? SAMPLE,
  );
  // True while the endpoint is missing and the layout is being filled with
  // invented figures. Loudly announced — a statement nobody can tell is a
  // sample is worse than no statement.
  const [sample, setSample] = useState(initialStatement === null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = initialStatement ?? SAMPLE;
  const [notes, setNotes] = useState<string[]>(start.notes);
  const [cycle, setCycle] = useState(String(start.cycle));
  const [status, setStatus] = useState(start.status);
  const [signatories, setSignatories] = useState<StatementSignatory[]>(
    start.signatories,
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Both, and each read on its own line.
   *
   * The PDF is the cash position in two currencies down to the last entry, so
   * it needs the permission to download *and* the permission to see what is
   * being downloaded — the same pair the endpoint asks for. Written as
   * `useCan(a) && useCan(b)` the second call is skipped whenever the first is
   * false, which is a hook that runs on some renders and not others.
   */
  const canRunExports = useCan("exports.run");
  const canSeeMoney = useCan("dashboard.money");
  const canExport = canRunExports && canSeeMoney;

  const adopt = useCallback((next: FinancialStatement) => {
    setStatement(next);
    setNotes(next.notes);
    setCycle(String(next.cycle));
    setStatus(next.status);
    setSignatories(next.signatories);
    setSaved(false);
  }, []);

  /**
   * The editable fields, wrapped so a change withdraws the "Saved" mark.
   * "Saved" sitting beside a textarea somebody has since typed into is a lie,
   * and this is the field where being lied to costs the most.
   */
  const editNotes: typeof setNotes = (value) => {
    setSaved(false);
    setNotes(value);
  };
  const editCycle: typeof setCycle = (value) => {
    setSaved(false);
    setCycle(value);
  };
  const editStatus: typeof setStatus = (value) => {
    setSaved(false);
    setStatus(value);
  };
  const editSignatories: typeof setSignatories = (value) => {
    setSaved(false);
    setSignatories(value);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await reportsApi.statement({
        granularity,
        fiscalYear,
        index,
      });
      adopt(next);
      setSample(false);
    } catch (caught) {
      // The endpoint is being built in parallel. Until it answers, the layout
      // renders from a fixture of the same shape rather than an empty screen.
      adopt(SAMPLE);
      setSample(true);
      const missing = caught instanceof ApiError && caught.status === 404;
      setError(
        missing
          ? null
          : caught instanceof ApiError
            ? caught.message
            : "Could not build the statement.",
      );
    } finally {
      setLoading(false);
    }
  }, [granularity, fiscalYear, index, adopt]);

  useEffect(() => {
    // Fetching on selection change; the setState happens in the await
    // continuation, not during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A different granularity is a different set of periods to choose from.
  useEffect(() => {
    let cancelled = false;
    void reportsApi.periods(granularity).then((next) => {
      if (cancelled) return;
      setPeriods(next);
      setIndex((current) => Math.min(current, next.periods.length || 1));
    });
    return () => {
      cancelled = true;
    };
  }, [granularity]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await reportsApi.saveStatement({
        periodStart: statement.period.start,
        periodEnd: statement.period.end,
        notes: notes.map((note) => note.trim()).filter(Boolean),
        status,
        cycle: Number(cycle) || 1,
        // The schema wants a real name and a real title; a half-filled row is
        // dropped rather than rejected, so one blank line cannot lose the note
        // somebody just spent ten minutes writing.
        signatories: signatories.filter(
          (person) =>
            person.name.trim().length >= 2 && person.title.trim().length >= 2,
        ),
      });
      // After the reload, not before: `load` adopts the server's copy and
      // clears the mark on its way through, so setting it first would raise
      // "Saved" only to wipe it a moment later.
      await load();
      setSaved(true);
    } catch (caught) {
      setSaveError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the statement.",
      );
    } finally {
      setSaving(false);
    }
  }

  const { period, company, summary, composition, outflow, ledgers } = statement;

  const donut = outflow.shares.map((share, i) => ({
    name: share.label,
    value: Number(share.amount.bdt),
    color: share.color ?? CHART_COLOURS[i % CHART_COLOURS.length],
  }));

  return (
    <div className="flex flex-col gap-4">
      {sample ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning"
        >
          <FileWarning className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">
              Sample figures, not your books.
            </strong>{" "}
            The statement endpoint has not answered, so the page below is filled
            with an invented period to show the layout. Nothing here can be
            saved.
          </span>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {/* --- header strip ---------------------------------------------- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="num flex size-12 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-lg font-semibold text-muted-foreground">
              {period.ordinal}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight">
                {period.label}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {company.name}
                {company.counterparty ? ` · ${company.counterparty}` : ""}
              </p>
              <p className="num mt-0.5 text-xs text-muted-foreground">
                {period.start} → {period.end}
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Badge tone="primary">
              Cycle {String(statement.cycle).padStart(2, "0")}
            </Badge>
            <Badge
              tone={statement.status === "reconciled" ? "positive" : "warning"}
            >
              {statement.status === "reconciled" ? (
                <CircleCheck className="size-3" />
              ) : null}
              {statement.status === "reconciled" ? "Reconciled" : "Draft"}
            </Badge>
            {statement.audited ? <Badge tone="neutral">Audited</Badge> : null}
            <Badge tone="neutral">
              <span className="num">{statement.lineItems}</span>
              {statement.lineItems === 1 ? " line item" : " line items"}
            </Badge>

            {/* The period length used to be a select here. It is the tab
                strip above now — four documents by name, all four in view. */}
            <Select
              aria-label="Financial year"
              title={
                periods.fiscalYearMode === "bd_july_june"
                  ? "July to June"
                  : "January to December"
              }
              className="h-9 w-auto"
              value={fiscalYear}
              disabled={loading}
              onChange={(event) => setFiscalYear(Number(event.target.value))}
            >
              {periods.years.map((year) => (
                <option key={year} value={year}>
                  {periods.fiscalYearMode === "bd_july_june"
                    ? `FY ${year}–${String(year + 1).slice(2)}`
                    : year}
                </option>
              ))}
            </Select>

            {periods.periods.length > 1 ? (
              <Select
                aria-label="Period"
                className="h-9 w-auto max-w-40"
                value={index}
                disabled={loading}
                onChange={(event) => setIndex(Number(event.target.value))}
              >
                {/* Greyed rather than dropped — a period that has not happened
                    still needs to be visibly there, or somebody looking for
                    September wonders whether the app has lost it. */}
                {periods.periods.map((entry) => (
                  <option
                    key={entry.index}
                    value={entry.index}
                    disabled={!entry.selectable}
                  >
                    {entry.label}
                  </option>
                ))}
              </Select>
            ) : null}

            {/*
              The document, as a document.

              Here rather than in the page header, where the Excel button for
              the other three tabs lives: this is a statement, not a table, so
              a spreadsheet of it would be a different thing — and the period
              it covers is chosen by the three selects immediately to the left
              of this button, not by the page.

              Nothing is downloaded on a sample: the endpoint would answer for
              a period that has no statement, and a PDF of placeholder figures
              is the one output nobody would notice was fake.
            */}
            {canExport && !sample ? (
              <Button
                variant="secondary"
                size="sm"
                className="h-9"
                disabled={loading}
                onClick={() => {
                  window.location.href = exportUrl("statement.pdf", {
                    granularity,
                    fiscalYear,
                    index,
                  });
                }}
              >
                <FileDown className="size-4" />
                PDF
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Assembling the statement…
        </div>
      ) : null}

      {/* --- the two figures the document exists to state --------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HeadlineCard
          label="Closing bank balance"
          hint={`as at ${period.end}`}
          value={summary.closing.bank}
        />
        {summary.closing.card ? (
          <HeadlineCard
            label="Closing card balance"
            hint="prepaid, not credit"
            value={summary.closing.card}
          />
        ) : (
          <Card className="flex flex-col justify-center p-5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Closing card balance
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              No card account was in use this period.
            </p>
          </Card>
        )}
      </div>

      {/* --- 01 executive summary --------------------------------------- */}
      <Card className="overflow-hidden">
        <SectionHeader
          ordinal="01"
          title="Executive summary"
          description="The period in four measures, and where it left the company."
        />
        <div className="overflow-x-auto">
          <table className="table-data min-w-140 text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Measure</th>
                <th className={th}>Basis</th>
                <th className={thRight}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {summary.lines.map((line) => (
                <tr key={line.label} className="row-finance">
                  <td className="px-4 py-2.5">
                    <span className="block font-medium">{line.label}</span>
                    {line.detail ? (
                      <span className="cell-prose block text-xs text-muted-foreground">
                        {line.detail}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={
                        line.basis === "Inflow"
                          ? "positive"
                          : line.basis === "Outflow"
                            ? "negative"
                            : "neutral"
                      }
                    >
                      {line.basis}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <MoneyPair value={line.amount} tone="auto" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-muted/30">
                <td className="px-4 py-3">
                  <span className="block font-semibold">Closing position</span>
                  <span className="block text-xs text-muted-foreground">
                    Bank
                    {summary.closing.card ? " and card" : ""}, as at{" "}
                    {period.end}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {summary.closing.card ? "Bank / Card" : "Bank"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-end gap-2">
                    <MoneyPair value={summary.closing.bank} size="lg" />
                    {summary.closing.card ? (
                      <MoneyPair value={summary.closing.card} />
                    ) : null}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* --- 02 cash composition ---------------------------------------- */}
      <Card className="overflow-hidden">
        <SectionHeader
          ordinal="02"
          title="Cash composition"
          description="What the closing bank balance is actually made of. Money held against a tax liability is in the account but is not the company's to spend."
        />
        <div className="overflow-x-auto">
          <table className="table-data min-w-140 text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Component</th>
                <th className={th}>Nature</th>
                <th className={thRight}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="row-finance">
                <td className="px-4 py-2.5">
                  <span className="block font-medium">Free cash</span>
                  <span className="cell-prose block text-xs text-muted-foreground">
                    Available to spend on{" "}
                    <span className="num">{period.end}</span>
                  </span>
                  {composition.committedForward ? (
                    <span className="cell-prose mt-1.5 flex flex-col gap-0.5 rounded-md bg-surface-muted px-2 py-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Info className="size-3 shrink-0" />
                        <span>
                          Includes{" "}
                          <span className="num font-medium text-foreground">
                            {formatMoney(composition.committedForward.bdt, {
                              currency: "BDT",
                              format,
                              hideDecimals: true,
                            })}
                          </span>{" "}
                          committed forward
                        </span>
                      </span>
                      {composition.committedForwardNote ? (
                        <span>{composition.committedForwardNote}</span>
                      ) : null}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone="positive">Free</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <MoneyPair value={composition.free} />
                </td>
              </tr>

              <tr className="row-finance bg-warning/5">
                <td className="px-4 py-2.5">
                  <span className="block font-medium text-warning">
                    Withheld tax
                  </span>
                  <span className="cell-prose block text-xs text-muted-foreground">
                    In the account, owed to the treasury
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone="warning">Restricted</Badge>
                </td>
                <td className="px-4 py-2.5">
                  <MoneyPair value={composition.restricted} />
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-muted/30">
                <td className="px-4 py-3 font-semibold">
                  Closing bank balance
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  Free + restricted
                </td>
                <td className="px-4 py-3">
                  <MoneyPair value={composition.total} size="lg" />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* --- 03 fund movement -------------------------------------------- */}
      <Card>
        <SectionHeader
          ordinal="03"
          title="Fund movement"
          description="Opening, every movement, closing. The two end pillars are positions; everything between them is a change."
        />
        <CardBody className="pt-2">
          {statement.waterfall.length ? (
            <WaterfallChart steps={statement.waterfall} />
          ) : (
            <Empty>Nothing moved in this period.</Empty>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Where it went"
          description={
            <span>
              Total outflow{" "}
              <span className="num font-medium text-foreground">
                {formatMoney(outflow.total.bdt, {
                  currency: "BDT",
                  format,
                  hideDecimals: true,
                })}
              </span>
              {outflow.total.usd ? (
                <>
                  {" · "}
                  <span className="num">
                    {outflow.total.estimated ? "≈ " : ""}
                    {formatMoney(outflow.total.usd, {
                      currency: "USD",
                      format: "western",
                      hideDecimals: true,
                    })}
                  </span>
                </>
              ) : null}
            </span>
          }
        />
        <CardBody>
          {donut.length ? (
            <CategoryDonut data={donut} />
          ) : (
            <Empty>Nothing was spent in this period.</Empty>
          )}
        </CardBody>
      </Card>

      {/* --- 04, 05, … the ledgers ---------------------------------------- */}
      {ledgers.map((ledger, i) => {
        // The API also synthesises an opening row at the head of `rows`. The
        // table already states the opening balance in its own row, so the
        // duplicate is dropped here rather than shown twice — and the test is
        // written so it does nothing if that row ever stops being sent.
        const first = ledger.rows[0];
        const rows =
          first &&
          first.id === null &&
          first.balance.bdt === ledger.opening.bdt &&
          first.amount.bdt === ledger.opening.bdt
            ? ledger.rows.slice(1)
            : ledger.rows;

        const rateRange =
          ledger.rateFrom && ledger.rateTo
            ? ledger.rateFrom === ledger.rateTo
              ? `Rate ৳${formatRate(ledger.rateFrom)}`
              : `Rates ৳${formatRate(ledger.rateFrom)} – ৳${formatRate(ledger.rateTo)}`
            : null;

        return (
          <Card key={ledger.accountId} className="overflow-hidden">
            <SectionHeader
              ordinal={String(i + 4).padStart(2, "0")}
              title={ledger.name}
              description={
                [
                  ledger.subtitle,
                  rateRange,
                  `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              }
            />
            <div className="overflow-x-auto">
              <table className="table-data min-w-180 text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left">
                    <th className={th}>Particulars</th>
                    <th className={th}>Type</th>
                    <th className={thRight}>Amount</th>
                    <th className={thRight}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="row-finance bg-surface-muted/30">
                    <td className="px-4 py-2.5 font-medium">Opening balance</td>
                    <td className="px-4 py-2.5 text-muted-foreground">—</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      —
                    </td>
                    <td className="px-4 py-2.5">
                      <MoneyPair value={ledger.opening} strong />
                    </td>
                  </tr>

                  {rows.map((row, r) => (
                    <tr
                      key={row.id ?? `${r}-${row.label}`}
                      className="row-finance hover:bg-surface-muted/50"
                    >
                      <td className="px-4 py-2.5">
                        <span className="block font-medium">{row.label}</span>
                        {row.detail ? (
                          <span className="cell-prose block text-xs text-muted-foreground">
                            {row.detail}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          tone={
                            row.direction === "in" ? "positive" : "negative"
                          }
                        >
                          {row.direction === "in" ? "IN" : "OUT"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <MoneyPair
                          value={row.amount}
                          tone={row.direction === "in" ? "in" : "out"}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <MoneyPair value={row.balance} />
                      </td>
                    </tr>
                  ))}

                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-4 py-10 text-center text-sm text-muted-foreground"
                      >
                        No entries on this account in {period.label}.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-surface-muted/30">
                    <td className="px-4 py-3 font-semibold">Closing balance</td>
                    <td className="px-4 py-3 num text-xs text-muted-foreground">
                      {ledger.currency}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3">
                      <MoneyPair value={ledger.closing} size="lg" />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        );
      })}

      {/* --- notes, cycle, status, signatories ---------------------------- */}
      <Card>
        <CardHeader
          title="Notes to the accounts"
          description="The parts a ledger cannot derive. Written by a person; the app supplies a first draft."
          action={
            <span className="num text-xs text-muted-foreground">
              {/* The API sends a full timestamp; the day is the part that
                  belongs on a statement. */}
              Generated {statement.generatedOn.slice(0, 10)}
            </span>
          }
        />
        <CardBody className="flex flex-col gap-5">
          <ol className="flex flex-col gap-3">
            {notes.map((note, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="num mt-2.5 w-6 shrink-0 text-xs text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <Textarea
                  aria-label={`Note ${i + 1}`}
                  className="min-w-0 flex-1"
                  rows={2}
                  maxLength={600}
                  value={note}
                  disabled={sample}
                  onChange={(event) =>
                    editNotes((current) =>
                      current.map((existing, at) =>
                        at === i ? event.target.value : existing,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={`Remove note ${i + 1}`}
                  disabled={sample}
                  className="mt-1 shrink-0"
                  onClick={() =>
                    editNotes((current) => current.filter((_, at) => at !== i))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
            {notes.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                No notes yet. A figure that needed explaining last month
                probably needs it again.
              </li>
            ) : null}
          </ol>

          <div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={sample || notes.length >= 30}
              onClick={() => editNotes((current) => [...current, ""])}
            >
              <Plus className="size-4" />
              Add a note
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Cycle</span>
              <Input
                inputMode="numeric"
                className="num w-28"
                value={cycle}
                disabled={sample}
                onChange={(event) =>
                  editCycle(event.target.value.replace(/\D/g, "").slice(0, 2))
                }
              />
              <span className="text-xs text-muted-foreground">
                Which statement this is within the financial year.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Status</span>
              <Select
                className="w-44"
                value={status}
                disabled={sample}
                onChange={(event) =>
                  editStatus(event.target.value as "draft" | "reconciled")
                }
              >
                <option value="draft">Draft</option>
                <option value="reconciled">Reconciled</option>
              </Select>
              <span className="text-xs text-muted-foreground">
                Reconciled means every figure was checked against the bank.
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Signed by</h3>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                disabled={sample || signatories.length >= 4}
                onClick={() =>
                  editSignatories((current) => [
                    ...current,
                    { name: "", title: "" },
                  ])
                }
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {signatories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody has signed this statement.
              </p>
            ) : null}

            {signatories.map((person, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <Input
                  aria-label={`Signatory ${i + 1} name`}
                  placeholder="Name"
                  className="min-w-40 flex-1"
                  value={person.name}
                  disabled={sample}
                  onChange={(event) =>
                    editSignatories((current) =>
                      current.map((existing, at) =>
                        at === i
                          ? { ...existing, name: event.target.value }
                          : existing,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Signatory ${i + 1} title`}
                  placeholder="Title"
                  className="min-w-40 flex-1"
                  value={person.title}
                  disabled={sample}
                  onChange={(event) =>
                    editSignatories((current) =>
                      current.map((existing, at) =>
                        at === i
                          ? { ...existing, title: event.target.value }
                          : existing,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="md"
                  type="button"
                  aria-label={`Remove signatory ${i + 1}`}
                  disabled={sample}
                  className="shrink-0"
                  onClick={() =>
                    editSignatories((current) =>
                      current.filter((_, at) => at !== i),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          {saveError ? (
            <p
              role="alert"
              className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
            >
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button
              variant="primary"
              size="md"
              type="button"
              disabled={sample || saving}
              onClick={() => void save()}
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Save
            </Button>
            {saved && !saving ? (
              <span className="flex items-center gap-1.5 text-xs text-positive">
                <CircleCheck className="size-3.5" />
                Saved
              </span>
            ) : null}
            {sample ? (
              <span className="text-xs text-muted-foreground">
                Saving is off while the page is showing sample figures.
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHeader({
  ordinal,
  title,
  description,
}: {
  ordinal: string;
  title: string;
  description?: string;
}) {
  return (
    <CardHeader
      title={
        <span className="flex items-baseline gap-2">
          <span className="num text-xs font-normal text-muted-foreground">
            {ordinal}
          </span>
          <span>{title}</span>
        </span>
      }
      description={description}
    />
  );
}

function HeadlineCard({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: Money2;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-3 flex flex-col items-start">
        <Amount
          value={value.bdt}
          currency="BDT"
          tone="auto"
          className="block text-3xl font-semibold tracking-tight"
        />
        <UsdLine value={value} className="mt-1 text-sm" />
      </div>
      <p className="num mt-2 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/* -------------------------------------------------------------------------- */
/*  A period that does not exist                                               */
/* -------------------------------------------------------------------------- */

const money = (
  bdt: string,
  usd: string | null,
  rate: string | null,
  estimated = false,
): Money2 => ({ bdt, usd, rate, ...(estimated ? { estimated: true } : {}) });

const BANK = "122.77";
const CARD = "123.00";
const MIXED = "122.81";

/**
 * Invented figures, used only when the statement endpoint does not answer.
 *
 * It exists so the layout can be built and reviewed against a realistic
 * period — mixed rates on the two accounts, a restricted balance, money
 * committed forward, and one measure whose dollars had to be estimated because
 * it spans both accounts. Anything rendered from it is flagged on screen.
 */
const SAMPLE: FinancialStatement = {
  period: {
    label: "July 2026",
    start: "2026-07-01",
    end: "2026-07-31",
    granularity: "month",
    ordinal: "07",
  },
  company: {
    name: "ShareViral Ltd",
    counterparty: "ShareViral LLC, Delaware",
  },
  cycle: 1,
  status: "draft",
  audited: false,
  lineItems: 9,

  summary: {
    lines: [
      {
        label: "Funds received",
        detail: "Remittance from ShareViral LLC and client receipts",
        basis: "Inflow",
        amount: money("2585000.00", "21055.63", BANK),
      },
      {
        label: "Operating outflow",
        detail: "Payroll, rent, utilities and the treasury deposit",
        basis: "Outflow",
        amount: money("1820500.00", "14828.53", BANK),
      },
      {
        label: "Card spend",
        detail: "Prepaid card · AI tooling and advertising",
        basis: "Card",
        amount: money("409500.00", "3329.27", CARD),
      },
      {
        label: "Net movement",
        detail: "Received less spent, across both accounts",
        basis: "Inflow",
        amount: money("355000.00", "2890.64", MIXED, true),
      },
    ],
    closing: {
      bank: money("2157000.00", "17569.44", BANK),
      card: money("102500.00", "833.33", CARD),
    },
  },

  composition: {
    free: money("1938600.00", "15790.34", BANK),
    restricted: money("218400.00", "1779.10", BANK),
    committedForward: money("660000.00", "5375.50", BANK),
    committedForwardNote:
      "August payroll, received from ShareViral LLC on 29 July. Free cash on 31 July, but spoken for.",
    total: money("2157000.00", "17569.44", BANK),
  },

  waterfall: [
    {
      label: "Opening",
      delta: null,
      balance: money("1842500.00", "15007.74", BANK),
      kind: "opening",
    },
    {
      label: "Funding in",
      delta: money("2200000.00", "17919.69", BANK),
      balance: money("4042500.00", "32927.43", BANK),
      kind: "in",
    },
    {
      label: "Client receipts",
      delta: money("385000.00", "3135.94", BANK),
      balance: money("4427500.00", "36063.37", BANK),
      kind: "in",
    },
    {
      label: "Salaries",
      delta: money("-1650000.00", "-13439.76", BANK),
      balance: money("2777500.00", "22623.61", BANK),
      kind: "out",
    },
    {
      label: "Card top-up",
      delta: money("-450000.00", "-3665.39", BANK),
      balance: money("2327500.00", "18958.22", BANK),
      kind: "out",
    },
    {
      label: "Rent & utilities",
      delta: money("-96500.00", "-786.02", BANK),
      balance: money("2231000.00", "18172.20", BANK),
      kind: "out",
    },
    {
      label: "Tax deposited",
      delta: money("-74000.00", "-602.75", BANK),
      balance: money("2157000.00", "17569.44", BANK),
      kind: "out",
    },
    {
      label: "Closing",
      delta: null,
      balance: money("2157000.00", "17569.44", BANK),
      kind: "closing",
    },
  ],

  outflow: {
    total: money("2230000.00", "18158.13", MIXED, true),
    shares: [
      {
        label: "Salaries",
        amount: money("1650000.00", "13439.76", BANK),
        share: 73.99,
        color: null,
      },
      {
        label: "AI tooling",
        amount: money("268000.00", "2178.86", CARD),
        share: 12.02,
        color: null,
      },
      {
        label: "Advertising",
        amount: money("141500.00", "1150.41", CARD),
        share: 6.35,
        color: null,
      },
      {
        label: "Rent & utilities",
        amount: money("96500.00", "786.02", BANK),
        share: 4.33,
        color: null,
      },
      {
        label: "Tax to treasury",
        amount: money("74000.00", "602.75", BANK),
        share: 3.32,
        color: null,
      },
    ],
  },

  ledgers: [
    {
      accountId: "sample-bank",
      name: "Operating account",
      subtitle: "Bangladesh Bank · current",
      currency: "BDT",
      rateFrom: BANK,
      rateTo: BANK,
      opening: money("1842500.00", "15007.74", BANK),
      closing: money("2157000.00", "17569.44", BANK),
      rows: [
        {
          id: "s1",
          label: "Remittance from ShareViral LLC",
          detail: "03 Jul · ref TT-2026-0703",
          direction: "in",
          amount: money("2200000.00", "17919.69", BANK),
          balance: money("4042500.00", "32927.43", BANK),
        },
        {
          id: "s2",
          label: "Client receipts",
          detail: "09 Jul · two invoices settled",
          direction: "in",
          amount: money("385000.00", "3135.94", BANK),
          balance: money("4427500.00", "36063.37", BANK),
        },
        {
          id: "s3",
          label: "July payroll",
          detail: "28 Jul · 14 employees, net of TDS",
          direction: "out",
          amount: money("1650000.00", "13439.76", BANK),
          balance: money("2777500.00", "22623.61", BANK),
        },
        {
          id: "s4",
          label: "Prepaid card top-up",
          detail: "05 Jul · transfer between own accounts",
          direction: "out",
          amount: money("450000.00", "3665.39", BANK),
          balance: money("2327500.00", "18958.22", BANK),
        },
        {
          id: "s5",
          label: "Office rent and utilities",
          detail: "06 Jul · Banani office",
          direction: "out",
          amount: money("96500.00", "786.02", BANK),
          balance: money("2231000.00", "18172.20", BANK),
        },
        {
          id: "s6",
          label: "TDS deposited to treasury",
          detail: "12 Jul · challan 4471-06",
          direction: "out",
          amount: money("74000.00", "602.75", BANK),
          balance: money("2157000.00", "17569.44", BANK),
        },
      ],
    },
    {
      accountId: "sample-card",
      name: "Prepaid card",
      subtitle: "Prepaid · AI tooling",
      currency: "BDT",
      rateFrom: CARD,
      rateTo: CARD,
      opening: money("62000.00", "504.07", CARD),
      closing: money("102500.00", "833.33", CARD),
      rows: [
        {
          id: "c1",
          label: "Top-up from operating account",
          detail: "05 Jul",
          direction: "in",
          amount: money("450000.00", "3658.54", CARD),
          balance: money("512000.00", "4162.60", CARD),
        },
        {
          id: "c2",
          label: "Model APIs",
          detail: "throughout July · no rate captured on the receipt",
          direction: "out",
          amount: money("268000.00", null, null),
          balance: money("244000.00", "1983.74", CARD),
        },
        {
          id: "c3",
          label: "Advertising",
          detail: "22 Jul · campaign spend",
          direction: "out",
          amount: money("141500.00", "1150.41", CARD),
          balance: money("102500.00", "833.33", CARD),
        },
      ],
    },
  ],

  notes: [
    "The prepaid card top-up of ৳4,50,000 on 5 July is a transfer between the company's own accounts. It is excluded from the outflow analysis in section 03; counting it there would show the same money leaving twice.",
    "৳2,18,400 of the closing bank balance is tax withheld from July salaries and vendor payments. It is in the account but is owed to the treasury by 7 August and is not available to spend.",
    "Dollar figures marked ≈ were translated at the period's closing rate because the entry itself carried no rate. Every other dollar figure is the rate that was recorded on the day.",
  ],

  signatories: [
    { name: "Mirza Ashiqul Islam", title: "Managing Director" },
    { name: "Farhana Rahman", title: "Head of Finance" },
  ],

  generatedOn: "2026-08-12",
};
