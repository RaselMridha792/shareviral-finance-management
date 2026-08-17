"use client";

import {
  MONTH_NAMES,
  formatMoney,
  todayInDhaka,
  type AccountGroup,
  type OverviewReport,
} from "@finance/shared";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  History,
  Receipt,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { StatTile, percentChange } from "@/components/dashboard/stat-tile";
import { useSettings } from "@/components/settings-provider";
import { Select } from "@/components/ui/field";

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
}: {
  firstName: string;
  report: OverviewReport;
  /** Calendar month, 1–12 — what the picker shows, not a fiscal index. */
  month: number;
  year: number;
  years: number[];
}) {
  const router = useRouter();
  const settings = useSettings();
  const [busy, startTransition] = useTransition();

  const { totals, previous } = report;
  const money = (value: string, options?: { hideDecimals?: boolean }) =>
    formatMoney(value, {
      currency: report.currency,
      format: settings.numberFormat,
      ...options,
    });

  /**
   * Whether the month on screen is over.
   *
   * Judged in Dhaka, not in the browser's timezone: at 3am on the first of
   * September a laptop set to UTC still says August, and the dashboard would
   * call a finished month current for six hours a month.
   */
  const [nowYear, nowMonth] = todayInDhaka().split("-").map(Number);
  const periodHasEnded = year < nowYear || (year === nowYear && month < nowMonth);

  // Both go in the URL, so a chosen month survives a refresh and can be sent
  // to somebody else and open on the same figures.
  function move(next: { month?: number; year?: number }) {
    const params = new URLSearchParams({
      month: String(next.month ?? month),
      year: String(next.year ?? year),
    });
    startTransition(() => router.push(`/?${params.toString()}`));
  }


  return (
    <>
      {/* --- heading and controls ------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Overview, {firstName}
          </h1>
          {/*
            The rate line is gone when there is a rate, and stays when there is
            not.

            It read "August 2026 · dollars at 118.30 per USD — the rate this
            month was funded at" under a heading that already says the month,
            beside two selects that already choose it. Every dollar figure on
            the page is greyed and marked as translated anyway, so the sentence
            was restating on every visit something worth knowing once.

            Its absence is a different matter: no rate means no dollar figures
            at all, and a page that silently drops half its numbers has to say
            why and where to fix it.
          */}
          {!report.usdRate ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No rate for this period, so no dollar figures. Set one in
              Settings, or record the month&apos;s funding with its rate.
            </p>
          ) : null}
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

        </div>
      </div>

      {/* --- the figures, grouped by what the money is ------------------ */}
      {report.groups.map((group) => (
        <AccountBlock key={group.key} group={group} ended={periodHasEnded} />
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
function AccountBlock({
  group,
  ended,
}: {
  group: AccountGroup;
  /** True when the month on screen is over, so the figure is a close. */
  ended: boolean;
}) {
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
        {/*
          The same figure under two names, and both are accurate.

          It has always been the *period's* close — opening as at the first of
          the month, plus what moved during it. On the month in progress that
          is what the accounts hold right now, so "Current balance" is the
          honest word. Look back at July from August and the number does not
          change meaning, but the word does: it is what July closed at, which
          is exactly what August opened with. Calling that "current" invites
          somebody to read a two-month-old figure as today's cash.
        */}
        <StatTile
          label={ended ? "Closing balance" : "Current balance"}
          value={group.closing}
          usd={group.usd.closing}
          icon={group.key === "card" ? CreditCard : Wallet}
          accent="primary"
          hint={
            ended
              ? "what the month closed at, and what the next opened with"
              : "opening + in − out"
          }
        />
      </div>
    </section>
  );
}

