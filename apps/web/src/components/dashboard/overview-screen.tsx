"use client";

import {
  MONTH_NAMES,
  formatMoney,
  isSelectableMonth,
  nearestSelectableMonth,
  todayInDhaka,
  type AccountGroup,
  type OverviewReport,
} from "@finance/shared";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ExpenseRow } from "@/components/dashboard/expense-row";
import { useSettings } from "@/components/settings-provider";
import { Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import {
  SectionHeading,
  ShareBar,
  StatCell,
  StatStrip,
  StatusPill,
} from "@/components/ui/patterns";

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
  const periodHasEnded =
    year < nowYear || (year === nowYear && month < nowMonth);

  // Both go in the URL, so a chosen month survives a refresh and can be sent
  // to somebody else and open on the same figures.
  function move(next: { month?: number; year?: number }) {
    const wantYear = next.year ?? year;
    /**
     * Changing the year can strand the month.
     *
     * On March 2027, switching the year to 2026 asks for March 2026 — before
     * the books begin. The month select greys that option out, but it was
     * already selected, so nothing stops the pair. Snapping to the nearest
     * month the year actually has means a year change always lands somewhere
     * real, rather than on a screen of zeroes that reads as a finding.
     */
    const wantMonth = nearestSelectableMonth(wantYear, next.month ?? month);

    const params = new URLSearchParams({
      month: String(wantMonth),
      year: String(wantYear),
    });
    startTransition(() => router.push(`/?${params.toString()}`));
  }

  return (
    <>
      {/* --- heading and controls ------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.02em]">
            <Icon
              name="space_dashboard"
              size={27}
              className="text-muted-foreground opacity-75"
            />
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
            {/*
              A month that has not happened, or one from before the books
              begin, is greyed rather than dropped. Not offered is a different
              thing from not there: somebody looking for September needs to see
              that September exists and is not yet available, instead of
              wondering whether the app has lost it.
            */}
            {MONTH_NAMES.map((name, i) => (
              <option
                key={name}
                value={i + 1}
                disabled={!isSelectableMonth(year, i + 1)}
              >
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

      {/*
        The four figures at the top of the screen, and which four is now a
        choice.

        It was a fixed row: salary, tools, tax withheld, tax not yet deposited.
        Three of those were right for this company and the fourth was an
        all-time obligation sitting in a row of period figures. More to the
        point, which figures matter is not a decision that can be made once, in
        advance, by somebody who does not watch this company's spending — so it
        is made here instead, by the person reading it.
      */}
      <ExpenseRow report={report} money={money} />
    </>
  );
}

/**
 * One account group: where it started, what moved, where it stands.
 *
 * The four read left to right as a sentence, and they tie —
 * opening + in − out is exactly current. Four figures in a box that do not add
 * up are four unrelated numbers, and a reader who checks once and finds they
 * disagree stops trusting the whole screen. The footnote under the last cell
 * says the arithmetic out loud so nobody has to work out whether it holds.
 */
function AccountBlock({
  group,
  ended,
}: {
  group: AccountGroup;
  /** True when the month on screen is over, so the figure is a close. */
  ended: boolean;
}) {
  const inflow = Number(group.moneyIn);
  const outflow = Number(group.moneyOut);
  const moved = inflow + outflow;
  const net = inflow - outflow;

  return (
    <section className="flex flex-col gap-3">
      {/*
        The accounts name themselves.

        It read "BD Bank overview" with the account names in grey beside it — a
        fixed label saying less than the line next to it, and the same names
        twice on one row. The names are the heading now.

        `group.label` remains the fallback. It cannot currently be reached — a
        group with no accounts is never built — but a heading that rendered as
        an empty string would be a worse way to find that out.
      */}
      <SectionHeading
        title={group.accounts.join(" · ") || group.label}
        icon={group.key === "card" ? "credit_card" : "account_balance"}
        iconTone="text-primary-text"
        aside={
          moved > 0 ? (
            <StatusPill tone={net >= 0 ? "positive" : "negative"}>
              {net >= 0 ? "Up" : "Down"}{" "}
              {money(Math.abs(net).toFixed(2), group)} this month
            </StatusPill>
          ) : null
        }
      />

      <StatStrip>
        {/* "Opening balance", not "Opening bank balance": the heading above
            already says which account this is, and the longer label was the one
            that wrapped. */}
        <StatCell
          label="Opening balance"
          icon="history"
          value={money(group.opening, group)}
          secondary={usd(group.usd.opening)}
          footnote="carried forward"
        />

        <StatCell
          label="Cash inflow"
          icon="south_west"
          iconTone="text-positive"
          value={money(group.moneyIn, group)}
          secondary={usd(group.usd.moneyIn)}
        >
          {/* How the month split between arriving and leaving. Drawn only when
              something moved: a full-width bar over two zeroes reads as a
              hundred per cent of nothing. */}
          {moved > 0 ? (
            <ShareBar share={inflow / moved} tone="bg-positive" />
          ) : null}
        </StatCell>

        <StatCell
          label="Cash outflow"
          icon="north_east"
          iconTone="text-negative"
          value={money(group.moneyOut, group)}
          secondary={usd(group.usd.moneyOut)}
        >
          {moved > 0 ? (
            <ShareBar share={outflow / moved} tone="bg-negative" />
          ) : null}
        </StatCell>

        {/*
          The same figure under two names, and both are accurate.

          It has always been the *period's* close — opening as at the first of
          the month, plus what moved during it. On the month in progress that is
          what the accounts hold right now, so "Current balance" is the honest
          word. Look back at July from August and the number does not change
          meaning, but the word does: it is what July closed at, which is
          exactly what August opened with. Calling that "current" invites
          somebody to read a two-month-old figure as today's cash.
        */}
        <StatCell
          emphasis
          label={ended ? "Closing balance" : "Current balance"}
          icon="account_balance_wallet"
          iconTone="text-primary-text"
          value={money(group.closing, group)}
          secondary={usd(group.usd.closing)}
          footnote={
            ended
              ? "what the month closed at, and what the next opened with"
              : "opening + in − out"
          }
        />
      </StatStrip>
    </section>
  );
}

/**
 * The dollar line under a figure.
 *
 * Grouped and marked approximate. It was printing the raw string, so a
 * thirty-two-thousand-dollar balance read as "$32579.88" — the one number on
 * the screen with no separators, directly under one that had them.
 */
function usd(value: string | null): string | null {
  return value === null ? null : `≈ ${formatMoney(value, { currency: "USD" })}`;
}

/** The group's own currency, not the report's — a card may be held in dollars. */
function money(value: string, group: AccountGroup): string {
  return formatMoney(value, { currency: group.currency });
}
