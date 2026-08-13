"use client";

import {
  GOVERNING_RATE_LABELS,
  MONTH_NAMES,
  formatMoney,
  type AccountGroup,
  type OverviewReport,
} from "@finance/shared";
import {
  ArrowDownLeft,
  ArrowUpRight,
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
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatTile, percentChange } from "@/components/dashboard/stat-tile";
import { useSettings } from "@/components/settings-provider";
import { Select } from "@/components/ui/field";
import { API_BASE_URL } from "@/lib/api-client";

/**
 * The screen somebody opens first, and often the only one they open.
 *
 * Three blocks and nothing else: what the bank holds, what the card holds,
 * what was spent. It carried a trend chart, a category donut, a deadline card,
 * a vendor ranking, an account list and a recent-entries feed below them —
 * every one of which restates, in a smaller and less exact form, something a
 * dedicated screen already shows properly. Cut on the owner's instruction, and
 * the page is better for it: the figures somebody opens this for are now the
 * whole page rather than the top of a long scroll.
 *
 * Each of those still lives where it belongs — the categories under Expenses,
 * the deadlines under TDS, the entries under Transactions.
 */
export function OverviewScreen({
  firstName,
  report,
  month,
  year,
  years,
  fiscalYear,
  index,
}: {
  firstName: string;
  report: OverviewReport;
  /** Calendar month, 1–12 — what the picker shows, not a fiscal index. */
  month: number;
  year: number;
  years: number[];
  /** The same month in the terms the API takes, for the export. */
  fiscalYear: number;
  index: number;
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

  // Both go in the URL, so a chosen month survives a refresh and can be sent
  // to somebody else and open on the same figures.
  function move(next: { month?: number; year?: number }) {
    const params = new URLSearchParams({
      month: String(next.month ?? month),
      year: String(next.year ?? year),
    });
    startTransition(() => router.push(`/?${params.toString()}`));
  }

  function exportPdf() {
    setExporting(true);
    // The month on screen, not whatever the server would default to. A report
    // that quietly covers a different period than the page it was downloaded
    // from is worse than no button.
    const params = new URLSearchParams({
      granularity: report.period.granularity,
      fiscalYear: String(fiscalYear),
      index: String(index),
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
                {" · dollars at "}
                <span className="num">{trimRate(report.usdRate)}</span>
                {" per USD — "}
                {/* Which of the three rates won. Without this, a month that
                    was funded looks broken after somebody edits the Settings
                    rate and sees nothing move: the funding rate is meant to
                    outrank it, and the screen has to say so. */}
                {report.usdRateSource
                  ? GOVERNING_RATE_LABELS[report.usdRateSource]
                  : null}
              </>
            ) : (
              " · no rate for this period, so no dollar figures. Set one in Settings, or record the month's funding with its rate."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Month"
            className="h-9 w-auto"
            value={month}
            disabled={busy}
            onChange={(event) => move({ month: Number(event.target.value) })}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Year"
            className="h-9 w-auto"
            value={year}
            disabled={busy}
            onChange={(event) => move({ year: Number(event.target.value) })}
          >
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
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
        {/* "Opening balance", not "Opening bank balance": the section heading
            above already says which account this is, and the longer label was
            the one that wrapped. */}
        <StatTile
          label="Opening balance"
          value={group.opening}
          usd={group.usd.opening}
          icon={History}
          hint="carried forward"
        />
        <StatTile
          label="Cash inflow"
          value={group.moneyIn}
          usd={group.usd.moneyIn}
          tone="in"
          icon={ArrowDownLeft}
          accent="positive"
        />
        <StatTile
          label="Cash outflow"
          value={group.moneyOut}
          usd={group.usd.moneyOut}
          tone="out"
          icon={ArrowUpRight}
          accent="negative"
        />
        <StatTile
          label="Current balance"
          value={group.closing}
          usd={group.usd.closing}
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
