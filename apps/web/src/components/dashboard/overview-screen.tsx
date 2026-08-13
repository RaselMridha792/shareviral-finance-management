"use client";

import {
  GRANULARITIES,
  formatMoney,
  type Granularity,
  type OverviewReport,
  type PendingItem,
} from "@finance/shared";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  FileDown,
  Landmark,
  LoaderCircle,
  Receipt,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CategoryDonut } from "@/components/charts/category-donut";
import { TrendChart } from "@/components/charts/trend-chart";
import { PendingCard } from "@/components/dashboard/pending-card";
import { StatTile, percentChange } from "@/components/dashboard/stat-tile";
import { Amount } from "@/components/money/amount";
import { useSettings } from "@/components/settings-provider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { API_BASE_URL } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  month: "Month",
  quarter: "Quarter",
  half: "Half year",
  year: "Year",
};

const CHART_COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/**
 * The screen somebody opens first, and often the only one they open.
 *
 * Ordered by what a person actually needs before they need anything else: what
 * is in the bank, what moved this period, what is owed and when, then the
 * shape of it, then the detail. A dashboard that opens with a chart makes the
 * reader hunt for the figure they came for.
 */
export function OverviewScreen({
  firstName,
  report,
  pending,
  canSeeUsd,
}: {
  firstName: string;
  report: OverviewReport;
  pending: PendingItem[];
  canSeeUsd: boolean;
}) {
  const router = useRouter();
  const settings = useSettings();
  const [busy, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);

  const { totals, previous } = report;
  const usd = report.currency === "USD";

  function move(next: Partial<{ granularity: string; currency: string }>) {
    const params = new URLSearchParams({
      granularity: next.granularity ?? report.period.granularity,
      currency: next.currency ?? report.currency,
    });
    startTransition(() => router.push(`/?${params.toString()}`));
  }

  function exportPdf() {
    setExporting(true);
    const params = new URLSearchParams({
      granularity: report.period.granularity,
      currency: report.currency,
    });
    // A download, not a navigation: an anchor with `download` leaves the page
    // where it is, and the API's Content-Disposition names the file. Assigning
    // window.location would work too, but Next rightly complains that it looks
    // like an internal navigation.
    const link = document.createElement("a");
    link.href = `${API_BASE_URL}/exports/overview.pdf?${params.toString()}`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    // The browser takes over from here; the spinner would otherwise never stop.
    window.setTimeout(() => setExporting(false), 2000);
  }

  const spendData = report.spendByCategory.slice(0, 6).map((line, i) => ({
    name: line.name,
    value: Number(line.total),
    color: line.color ?? CHART_COLOURS[i % CHART_COLOURS.length],
  }));

  const biggestVendor = report.topVendors[0];

  return (
    <>
      {/* --- heading and controls ------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Overview, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.period.label}
            {report.fx ? (
              <>
                {" · "}
                <span className="num">{report.fx.caption}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Period length"
            className="h-9 w-auto"
            value={report.period.granularity}
            disabled={busy}
            onChange={(event) => move({ granularity: event.target.value })}
          >
            {GRANULARITIES.map((option) => (
              <option key={option} value={option}>
                {GRANULARITY_LABELS[option]}
              </option>
            ))}
          </Select>

          {canSeeUsd ? (
            <Select
              aria-label="Currency"
              className="h-9 w-auto"
              value={report.currency}
              disabled={busy}
              onChange={(event) => move({ currency: event.target.value })}
            >
              <option value="BDT">৳ BDT</option>
              <option value="USD">$ USD</option>
            </Select>
          ) : null}

          <button
            type="button"
            onClick={exportPdf}
            disabled={exporting}
            className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
          >
            {exporting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            Export report
          </button>
        </div>
      </div>

      {usd ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          Every figure here is taka translated at{" "}
          <span className="num">{report.fx?.caption}</span>. Two periods at
          different rates will look like the business moved when only the
          currency did.
        </p>
      ) : null}

      {/* --- the figures ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Cash in hand"
          value={totals.cashInHand}
          hint="every account, today"
          icon={Wallet}
          accent="primary"
        />
        <StatTile
          label="Money in"
          value={totals.moneyIn}
          tone="in"
          icon={ArrowDownLeft}
          accent="positive"
          change={percentChange(totals.moneyIn, previous?.moneyIn)}
          hint={previous ? `vs ${previous.label}` : undefined}
        />
        <StatTile
          label="Money out"
          value={totals.moneyOut}
          tone="out"
          icon={ArrowUpRight}
          accent="negative"
          change={percentChange(totals.moneyOut, previous?.moneyOut)}
          risingIsGood={false}
          hint={previous ? `vs ${previous.label}` : undefined}
        />
        <StatTile
          label="Net for the period"
          value={totals.net}
          icon={Scale}
          accent={Number(totals.net) >= 0 ? "positive" : "negative"}
          hint={`${totals.entries} entries`}
        />

        <StatTile
          label="Salary paid"
          value={totals.salaryPaid}
          icon={Users}
          change={percentChange(totals.salaryPaid, previous?.salaryPaid)}
          risingIsGood={false}
          hint={`${report.headcount.employees} on payroll`}
        />
        <StatTile
          label="Funding received"
          value={totals.fundingReceived}
          tone="in"
          icon={Landmark}
          change={percentChange(
            totals.fundingReceived,
            previous?.fundingReceived,
          )}
          hint="from abroad"
        />
        <StatTile
          label="Tax withheld"
          value={totals.taxWithheld}
          icon={Receipt}
          hint={`${formatMoney(totals.taxDeposited, {
            currency: report.currency,
            format: settings.numberFormat,
            hideDecimals: true,
          })} deposited`}
        />
        <StatTile
          label="Tax not yet deposited"
          value={totals.taxOutstanding}
          icon={CalendarClock}
          accent={Number(totals.taxOutstanding) > 0 ? "warning" : "muted"}
          hint="all time, not this period"
        />
      </div>

      {/* --- the shape of it ------------------------------------------ */}
      <Card>
        <CardHeader
          title="Twelve months"
          description="Bars are what moved each month. The line is what was left in the bank at the end of it."
        />
        <CardBody className="pt-2">
          <TrendChart months={report.months} currency={report.currency} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Where the money went"
            description={report.period.label}
            action={
              <Link
                href="/expenses"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Expenses
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody>
            {spendData.length ? (
              <CategoryDonut data={spendData} />
            ) : (
              <Empty>Nothing was spent in this period.</Empty>
            )}
          </CardBody>
        </Card>

        <PendingCard items={pending} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* --- top vendors ------------------------------------------- */}
        <Card>
          <CardHeader
            title="Paid the most"
            description={report.period.label}
            action={
              <Link
                href="/vendors"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Vendors
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {report.topVendors.length ? (
              report.topVendors.map((vendor) => (
                <div key={vendor.name} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{vendor.name}</span>
                    <Amount
                      value={vendor.total}
                      hideDecimals
                      className="shrink-0 text-sm font-medium"
                    />
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${biggestVendor ? (Number(vendor.total) / Number(biggestVendor.total)) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <Empty>Nothing was paid to a named vendor.</Empty>
            )}
          </CardBody>
        </Card>

        {/* --- accounts ---------------------------------------------- */}
        <Card>
          <CardHeader
            title="Accounts"
            description={`${report.balances.length} in use`}
            action={
              <Link
                href="/accounts"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                All
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {report.balances.map((account) => (
              <Link
                key={account.id}
                href={`/accounts/${account.id}`}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 -mx-2 transition hover:bg-surface-muted"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
                    <Banknote className="size-4" />
                  </span>
                  <span className="truncate text-sm">{account.name}</span>
                </span>
                <Amount
                  value={account.balance}
                  hideDecimals
                  className="shrink-0 text-sm font-medium"
                />
              </Link>
            ))}
          </CardBody>
        </Card>

        {/* --- recent ------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Latest entries"
            action={
              <Link
                href="/transactions"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                All
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody className="flex flex-col gap-2.5">
            {report.recent.length ? (
              report.recent.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {entry.description}
                    </span>
                    <span className="num text-xs text-muted-foreground">
                      {entry.txnDate}
                      {entry.categoryName ? ` · ${entry.categoryName}` : ""}
                    </span>
                  </span>
                  <Amount
                    value={
                      entry.direction === "out"
                        ? `-${entry.amount}`
                        : entry.amount
                    }
                    hideDecimals
                    tone={entry.direction === "in" ? "in" : "out"}
                    className="shrink-0 text-sm font-medium"
                  />
                </div>
              ))
            ) : (
              <Empty>Nothing recorded yet.</Empty>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <p className={cn("py-6 text-center text-sm text-muted-foreground")}>
      {children}
    </p>
  );
}
