"use client";

import {
  MONTH_NAMES,
  formatMoney,
  fromMinorUnits,
  isSelectableMonth,
  monthRange,
  nearestSelectableMonth,
  toMinorUnits,
  todayInDhaka,
  type OverviewReport,
} from "@finance/shared";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AccountBlocks } from "@/components/dashboard/account-blocks";
import { ExpenseRow } from "@/components/dashboard/expense-row";
import { Greeting } from "@/components/dashboard/greeting";
import { QuickLinks } from "@/components/dashboard/quick-links";
import { useSettings } from "@/components/settings-provider";

/**
 * The screen somebody opens first, and often the only one they open — as the
 * September 2026 handoff draws it.
 *
 * A violet greeting card that also holds the period and the one total worth
 * a glance, then one block per account, then the spending. It carried a trend
 * chart, a category donut, a deadline card, a vendor ranking, an account list
 * and a recent-entries feed once — every one of which restates, smaller and
 * less exactly, something a dedicated screen shows properly. They went on the
 * owner's instruction and the handoff did not bring them back.
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
  /** Whether the account blocks are being put in order. */
  const [arranging, setArranging] = useState(false);

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

  /**
   * What the accounts on screen held at the end of the period — the four
   * cards' last figure, added up.
   *
   * In paisa, as whole numbers: money here is never added as floating point.
   * The same figure the blocks below close on, so the card and the blocks
   * cannot disagree.
   */
  const held = fromMinorUnits(
    report.groups.reduce(
      (sum, group) => sum + toMinorUnits(group.closing),
      BigInt(0),
    ),
  );

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

  /** The month on screen as dates — what a card's register opens on. */
  const range = monthRange(year, month);

  return (
    <>
      <Greeting
        lead="Overview"
        name={firstName}
        aside={
          <>
            <div className="flex flex-wrap justify-end gap-2">
              <select
                aria-label="Month"
                value={month}
                disabled={busy}
                onChange={(event) =>
                  move({ month: Number(event.target.value) })
                }
                className="sv-hero-control h-10.5 cursor-pointer rounded-lg bg-(--sv-surface) px-3 text-[14px] font-extrabold disabled:cursor-wait"
              >
                {/*
                  A month that has not happened, or one from before the books
                  begin, is greyed rather than dropped: somebody looking for
                  September needs to see that September exists and is not yet
                  available, instead of wondering whether the app has lost it.
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
              </select>

              <select
                aria-label="Year"
                value={year}
                disabled={busy}
                onChange={(event) => move({ year: Number(event.target.value) })}
                className="sv-hero-control h-10.5 cursor-pointer rounded-lg bg-(--sv-surface) px-3 text-[14px] font-extrabold disabled:cursor-wait"
              >
                {years.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {/* Arranging the accounts. There is nothing to arrange with one. */}
              {report.groups.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setArranging((was) => !was)}
                  aria-pressed={arranging}
                  className="sv-hero-control inline-flex h-10.5 cursor-pointer items-center gap-1.75 rounded-lg bg-(--sv-surface) px-3.5 text-[14px] font-extrabold"
                >
                  {arranging ? (
                    <CheckIcon
                      weight="duotone"
                      size={17}
                      className="text-(--sv-violet)"
                    />
                  ) : (
                    <PencilSimpleIcon
                      weight="duotone"
                      size={17}
                      className="text-(--sv-violet)"
                    />
                  )}
                  {arranging ? "Done" : "Edit"}
                </button>
              ) : null}
            </div>

            <div className="text-right">
              <p className="text-[11px] tracking-[0.14em] text-(--sv-violet-ink) uppercase">
                {/* The same honesty as the cards' "current" and "closing": on
                    a month already over, this is what it ended with. */}
                {periodHasEnded
                  ? `Held at the end of ${MONTH_NAMES[month - 1]}`
                  : "Total held"}
              </p>
              <p className="text-[30px] font-extrabold tracking-[-0.02em] tabular-nums">
                {formatMoney(held, {
                  currency: "BDT",
                  format: settings.numberFormat,
                })}
              </p>
            </div>
          </>
        }
      >
        {/*
          No chips. Accounts, on payroll and renewals this month sat here as
          three counts; the owner had them taken off — "dashbaord theke ei
          3take soriye daw aigula rakhar dorkar nai". The accounts are the
          blocks below, the payroll count is on Salary paid, and the renewals
          are on AI tools and subscriptions.
        */}
        {/*
          The rate line is gone when there is a rate, and stays when there is
          not: no rate means no dollar figures at all, and a page that silently
          drops half its numbers has to say why and where to fix it.
        */}
        {!report.usdRate ? (
          <p className="mt-3 text-[13px] text-(--sv-violet-ink)">
            No rate for this period, so no dollar figures. Set one in Settings,
            or record the month&apos;s funding with its rate.
          </p>
        ) : null}
        <QuickLinks />
      </Greeting>

      {/* --- one block per account, in the order somebody chose ---------- */}
      <AccountBlocks
        // A fresh instance each time arranging starts or stops, so a draft
        // order never outlives the session it was made in.
        key={arranging ? "arranging" : "reading"}
        groups={report.groups}
        ended={periodHasEnded}
        editing={arranging}
        range={{ from: range.start, to: range.end }}
        // December's opening is carried from November, and January's from
        // December — hence the wrap rather than `month - 2`.
        previousMonthName={MONTH_NAMES[(month + 10) % 12]}
      />

      {/*
        The figures under the accounts, and which ones is a choice made by the
        person reading — salary, tools, TDS and the total by default.
      */}
      <ExpenseRow report={report} money={money} />
    </>
  );
}
