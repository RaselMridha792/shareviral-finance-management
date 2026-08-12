"use client";

import {
  GRANULARITIES,
  todayInDhaka,
  type BankStats,
  type CurrencyView,
  type FundingReport,
  type Granularity,
  type PeriodReport,
} from "@finance/shared";
import { Info, LoaderCircle, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { reportsApi, type AvailablePeriods } from "@/lib/reports";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "period", label: "The period" },
  { id: "bank", label: "Month by month" },
  { id: "funding", label: "Funding from the CEO" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const GRANULARITY_LABELS: Record<Granularity, string> = {
  month: "Month",
  quarter: "Quarter",
  half: "Half year",
  year: "Full year",
};

const th =
  "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const thRight = `${th} text-right`;

export function ReportsScreen({
  initialPeriods,
  initialReport,
}: {
  initialPeriods: AvailablePeriods;
  initialReport: PeriodReport;
}) {
  const canSeeUsd = useCan("reports.usd");
  const [tab, setTab] = useState<TabId>("period");

  const [granularity, setGranularity] = useState<Granularity>("month");
  const [periods, setPeriods] = useState(initialPeriods);
  const [fiscalYear, setFiscalYear] = useState(initialPeriods.years[1]);
  const [index, setIndex] = useState(
    // Default to the period we are actually in, not the first of the year.
    Math.max(
      1,
      initialPeriods.periods.findIndex(
        (p) => todayInDhaka() >= p.start && todayInDhaka() <= p.end,
      ) + 1,
    ),
  );
  const [currency, setCurrency] = useState<CurrencyView>("BDT");

  const [report, setReport] = useState<PeriodReport | null>(initialReport);
  const [bank, setBank] = useState<BankStats | null>(null);
  const [funding, setFunding] = useState<FundingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "period") {
        setReport(
          await reportsApi.period({ granularity, fiscalYear, index, currency }),
        );
      } else if (tab === "bank") {
        setBank(
          await reportsApi.bankStats({
            year: fiscalYear,
            currency,
          }),
        );
      } else {
        setFunding(await reportsApi.funding());
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not build that report.",
      );
    } finally {
      setLoading(false);
    }
  }, [tab, granularity, fiscalYear, index, currency]);

  useEffect(() => {
    // Fetching from the API when the selection changes — setState happens in
    // the await continuation, not during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A different granularity means a different set of periods to choose from.
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

  return (
    <>
      <PageHeader
        title="Reports"
        description="What came in, what went out, and what it looks like in dollars."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="tablist"
          aria-label="Report"
          className="flex gap-1 border-b border-border"
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === entry.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === "period" ? (
            <>
              <Select
                aria-label="Granularity"
                className="h-9 w-32"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
              >
                {GRANULARITIES.map((g) => (
                  <option key={g} value={g}>
                    {GRANULARITY_LABELS[g]}
                  </option>
                ))}
              </Select>
              {periods.periods.length > 1 ? (
                <Select
                  aria-label="Period"
                  className="h-9 w-40"
                  value={index}
                  onChange={(e) => setIndex(Number(e.target.value))}
                >
                  {periods.periods.map((p) => (
                    <option key={p.index} value={p.index}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              ) : null}
            </>
          ) : null}

          {tab !== "funding" ? (
            <Select
              aria-label="Year"
              className="h-9 w-24"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
            >
              {periods.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          ) : null}

          {canSeeUsd && tab !== "funding" ? (
            <div className="flex rounded-lg border border-border p-0.5">
              {(["BDT", "USD"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCurrency(option)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition",
                    currency === option
                      ? "bg-primary text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option === "BDT" ? "৳ Taka" : "$ Dollars"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Working it out…
        </div>
      ) : null}

      {tab === "period" && report ? <PeriodView report={report} /> : null}
      {tab === "bank" && bank ? <BankView stats={bank} /> : null}
      {tab === "funding" && funding ? <FundingView report={funding} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The sentence under a dollar figure.
 *
 * Always shown when the figures were translated, never hidden behind a tooltip:
 * the same month at two rates differs by pure currency movement, and a reader
 * who cannot see which rate produced the number cannot know that.
 */
function FxCaption({ report }: { report: { currency: string; fx: unknown } }) {
  const fx = report.fx as { caption: string; unavailable: boolean } | null;
  if (!fx) return null;

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        fx.unavailable ? "text-warning" : "text-muted-foreground",
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {fx.unavailable ? "Not converted — " : "Figures in US dollars, "}
        {fx.caption}
      </span>
    </p>
  );
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;

  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 text-xs font-medium",
        good ? "text-positive" : "text-negative",
      )}
    >
      <Icon className="size-3.5" />
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function PeriodView({ report }: { report: PeriodReport }) {
  const ccy = report.currency;
  const change = (now: string, before: string | undefined) => {
    if (before === undefined || Number(before) === 0) return null;
    return ((Number(now) - Number(before)) / Number(before)) * 100;
  };

  return (
    <div className="flex flex-col gap-4">
      <FxCaption report={report} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Opening balance" value={report.openingBalance} currency={ccy} />
        <Tile
          label="In"
          value={report.moneyIn}
          currency={ccy}
          tone="in"
          delta={change(report.moneyIn, report.previous?.moneyIn)}
          hint={report.previous ? `vs ${report.previous.label}` : undefined}
        />
        <Tile
          label="Out"
          value={report.moneyOut}
          currency={ccy}
          tone="out"
          invertDelta
          delta={change(report.moneyOut, report.previous?.moneyOut)}
          hint={report.previous ? `vs ${report.previous.label}` : undefined}
        />
        <Tile
          label="Closing balance"
          value={report.closingBalance}
          currency={ccy}
          hint={`${report.entries} entr${report.entries === 1 ? "y" : "ies"}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryCard
          title="Where it went"
          description={report.label}
          lines={report.spendByCategory}
          currency={ccy}
        />
        <CategoryCard
          title="Where it came from"
          description={report.label}
          lines={report.incomeByCategory}
          currency={ccy}
        />
      </div>
    </div>
  );
}

function CategoryCard({
  title,
  description,
  lines,
  currency,
}: {
  title: string;
  description: string;
  lines: PeriodReport["spendByCategory"];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing in this period.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.id ?? line.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: line.color ?? "var(--color-border)" }}
                    />
                    <span className="truncate font-medium">{line.name}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="num text-xs text-muted-foreground">
                      {line.share.toFixed(0)}%
                    </span>
                    <Amount
                      value={line.total}
                      currency={currency}
                      tone="neutral"
                      className="text-sm font-medium"
                    />
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.max(line.share, 1)}%`,
                      background: line.color ?? "var(--color-muted-foreground)",
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function BankView({ stats }: { stats: BankStats }) {
  const active = stats.months.filter((m) => m.entries > 0);

  return (
    <div className="flex flex-col gap-4">
      <FxCaption report={stats} />

      <Card className="overflow-hidden">
        <CardHeader
          title={`${stats.accountName} · ${stats.year}`}
          description={
            stats.busiest
              ? `Busiest month: ${stats.busiest.label}, ${stats.busiest.entries} entries`
              : "Nothing recorded this year"
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Month</th>
                <th className={thRight}>In</th>
                <th className={th}>vs before</th>
                <th className={thRight}>Out</th>
                <th className={th}>vs before</th>
                <th className={thRight}>Net</th>
                <th className={thRight}>Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {active.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No entries in {stats.year}.
                  </td>
                </tr>
              ) : (
                active.map((month) => (
                  <tr
                    key={month.month}
                    className="row-finance hover:bg-surface-muted/50"
                  >
                    <td className="px-4 py-2.5 font-medium">{month.label}</td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={month.moneyIn}
                        currency={stats.currency}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Delta value={month.inChange} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={month.moneyOut}
                        currency={stats.currency}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Delta value={month.outChange} invert />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={month.net}
                        currency={stats.currency}
                        className="block font-medium"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={month.closingBalance}
                        currency={stats.currency}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {active.length ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-muted/30">
                  <td className="px-4 py-2.5 text-sm font-semibold">Year</td>
                  <td className="px-4 py-2.5">
                    <Amount
                      value={stats.totals.moneyIn}
                      currency={stats.currency}
                      tone="neutral"
                      className="block font-semibold"
                    />
                  </td>
                  <td />
                  <td className="px-4 py-2.5">
                    <Amount
                      value={stats.totals.moneyOut}
                      currency={stats.currency}
                      tone="neutral"
                      className="block font-semibold"
                    />
                  </td>
                  <td />
                  <td className="px-4 py-2.5">
                    <Amount
                      value={stats.totals.net}
                      currency={stats.currency}
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
    </div>
  );
}

function FundingView({ report }: { report: FundingReport }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          These dollars are real, not translated. Each rate is what that
          transfer actually achieved once the bank had taken its cut, recorded
          on the day and never recalculated.
        </span>
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Sent" value={report.totals.usdSent} currency="USD" />
        <Tile label="Landed" value={report.totals.bdtReceived} currency="BDT" />
        <Card className="flex flex-col gap-1 px-4 py-3.5">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Average rate
          </span>
          <span className="num text-xl font-medium">
            {report.totals.averageRate}
          </span>
          <span className="text-xs text-muted-foreground">
            weighted by size, not an average of averages
          </span>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Every remittance"
          description="What was sent, what arrived, and the rate it really got"
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Date</th>
                <th className={th}>Reference</th>
                <th className={th}>Into</th>
                <th className={thRight}>Sent</th>
                <th className={thRight}>Landed</th>
                <th className={thRight}>Rate achieved</th>
                <th className={thRight}>Market that day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.remittances.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No USD remittances recorded yet. Add one as a money-in entry
                    with the dollar amount and the rate the bank gave.
                  </td>
                </tr>
              ) : (
                report.remittances.map((row) => (
                  <tr
                    key={row.id}
                    className="row-finance hover:bg-surface-muted/50"
                  >
                    <td className="num px-4 py-2.5">{row.txnDate}</td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {row.refNo}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.accountName}
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={row.usdSent}
                        currency="USD"
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={row.bdtReceived}
                        currency="BDT"
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="num px-4 py-2.5 text-right font-medium">
                      {row.realisedRate}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-muted-foreground">
                      {row.marketRate ?? "—"}
                      {row.spread && Number(row.spread) > 0 ? (
                        <Badge tone="neutral" className="ml-2">
                          cost ৳{Number(row.spread).toFixed(0)}
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  currency,
  hint,
  delta,
  invertDelta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  currency: string;
  hint?: string;
  delta?: number | null;
  invertDelta?: boolean;
  tone?: "in" | "out" | "neutral";
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <Amount
        value={value}
        currency={currency}
        tone={tone === "neutral" ? "auto" : tone}
        className="mt-3 block text-2xl font-semibold tracking-tight"
      />
      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined ? <Delta value={delta} invert={invertDelta} /> : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
    </Card>
  );
}
