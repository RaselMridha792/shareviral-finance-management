"use client";

import {
  GRANULARITIES,
  formatMoney,
  type AccountGroup,
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
  CreditCard,
  FileDown,
  History,
  LoaderCircle,
  Receipt,
  Sparkles,
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
}: {
  firstName: string;
  report: OverviewReport;
  pending: PendingItem[];
}) {
  const router = useRouter();
  const settings = useSettings();
  const [busy, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);

  const { totals, previous } = report;
  const money = (value: string, options?: { hideDecimals?: boolean }) =>
    formatMoney(value, {
      currency: report.currency,
      format: settings.numberFormat,
      ...options,
    });

  function move(next: { granularity: string }) {
    startTransition(() =>
      router.push(`/?granularity=${next.granularity}`),
    );
  }

  function exportPdf() {
    setExporting(true);
    const params = new URLSearchParams({
      granularity: report.period.granularity,
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
            {report.usdRate ? (
              <>
                {" · dollars shown at "}
                <span className="num">{trimRate(report.usdRate)}</span>
                {" per USD"}
              </>
            ) : (
              " · no rate on record, so no dollar figures"
            )}
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

      {/* --- the figures, grouped by what the money is ------------------ */}
      {report.groups.map((group) => (
        <AccountBlock key={group.key} group={group} />
      ))}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Expense overview
          </h2>
          <span className="text-xs text-muted-foreground">
            {report.period.label}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Salary paid"
            value={report.expense.salaryPaid}
            usd={report.expense.usd.salaryPaid}
            icon={Users}
            change={percentChange(
              report.expense.salaryPaid,
              previous?.salaryPaid,
            )}
            risingIsGood={false}
            hint={`${report.headcount.employees} on payroll`}
          />
          <StatTile
            label="AI & other tools"
            value={report.expense.toolsAndSubscriptions}
            usd={report.expense.usd.toolsAndSubscriptions}
            icon={Sparkles}
            hint="subscriptions and the card"
          />
          <StatTile
            label="Tax withheld"
            value={report.expense.taxWithheld}
            usd={report.expense.usd.taxWithheld}
            icon={Receipt}
            hint={`${money(totals.taxDeposited, { hideDecimals: true })} deposited`}
          />
          <StatTile
            label="Tax not yet deposited"
            value={report.expense.taxOutstanding}
            usd={report.expense.usd.taxOutstanding}
            icon={CalendarClock}
            accent={
              Number(report.expense.taxOutstanding) > 0 ? "warning" : "muted"
            }
            hint="all time, not this period"
          />
        </div>
      </section>

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

/**
 * One account group: where it started, what moved, where it stands.
 *
 * The four read left to right as a sentence, and they tie —
 * opening + in − out is exactly current. Four figures in a box that do not
 * add up are four unrelated numbers, and a reader who checks once and finds
 * they disagree stops trusting the whole screen.
 */
function AccountBlock({ group }: { group: AccountGroup }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight">{group.label}</h2>
        <span className="truncate text-xs text-muted-foreground">
          {group.accounts.join(" · ")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={
            group.key === "card"
              ? "Opening card balance"
              : "Opening bank balance"
          }
          value={group.opening}
          icon={History}
          hint="carried forward"
        />
        <StatTile
          label="Cash inflow"
          value={group.moneyIn}
          tone="in"
          icon={ArrowDownLeft}
          accent="positive"
        />
        <StatTile
          label="Cash outflow"
          value={group.moneyOut}
          tone="out"
          icon={ArrowUpRight}
          accent="negative"
        />
        <StatTile
          label={
            group.key === "card"
              ? "Current card balance"
              : "Current bank balance"
          }
          value={group.closing}
          icon={group.key === "card" ? CreditCard : Wallet}
          accent="primary"
          hint="opening + in − out"
        />
      </div>
    </section>
  );
}

/** "118.300000" is a database column; "118.30" is a rate somebody reads. */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}

function Empty({ children }: { children: string }) {
  return (
    <p className={cn("py-6 text-center text-sm text-muted-foreground")}>
      {children}
    </p>
  );
}
