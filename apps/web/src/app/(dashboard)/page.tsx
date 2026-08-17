import {
  fiscalYearOf,
  hasPermission,
  monthIndexInFiscalYear,
  todayInDhaka,
} from "@finance/shared";
import type { FiscalYearMode, PendingItem } from "@finance/shared";

import { HrDashboard } from "@/components/dashboard/hr-dashboard";
import { OverviewScreen } from "@/components/dashboard/overview-screen";
import { getSession } from "@/lib/api-client";
import { reportsApi } from "@/lib/reports";
import { tdsApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSession();
  const params = await searchParams;

  // HR signs in here too and holds none of the money permissions. Asking for
  // figures they may not see would 403 and take the whole page down, so the
  // decision is made before the request rather than after it.
  const seesMoney = hasPermission(user?.role, "dashboard.money");

  if (!seesMoney) {
    // TDS deadlines only. The income tax screen was retired on the owner's
    // instruction, so nothing here links to one — the records and the
    // /income-tax endpoints are still there, just not shown.
    const pending: PendingItem[] = hasPermission(user?.role, "tds.read")
      ? [...(await tdsApi.pending())].sort((a, b) =>
          a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0,
        )
      : [];

    return (
      <HrDashboard
        firstName={user?.fullName.split(" ")[0] ?? "there"}
        pending={pending}
      />
    );
  }

  // Which fiscal year the app is keeping books in — the picker is in calendar
  // months and years, and July is period 1 of a Bangladeshi year while January
  // is period 1 of a calendar one. Read rather than assumed.
  const available = await reportsApi.periods("month");
  const mode = available.fiscalYearMode;

  const today = todayInDhaka();
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));

  // Latest month unless asked otherwise. A dashboard that opens on a period
  // somebody chose last week is a dashboard showing stale figures to someone
  // who has not noticed.
  const month = monthParam(params.month) ?? thisMonth;
  const year = yearParam(params.year) ?? thisYear;

  const period = periodOf(year, month, mode);
  const report = await reportsApi.overview({ granularity: "month", ...period });

  return (
    <OverviewScreen
      firstName={user?.fullName.split(" ")[0] ?? "there"}
      report={report}
      month={month}
      year={year}
      years={calendarYears(available.years, mode, thisYear, year)}
      // So the Export button asks for the month on screen rather than the
      // server's default. `report.period` carries the dates but not the
      // coordinates the endpoint takes, and they are already worked out here.
    />
  );
}

/**
 * A calendar month and year, in the terms `/reports/overview` takes.
 *
 * The endpoint asks for a fiscal year and a position within it. In July the two
 * disagree: July 2026 is period 1 of financial year 2026, while January 2026 is
 * period 7 of financial year 2025. Converting here rather than in the picker is
 * what lets the picker stay in the months and years people actually say.
 */
function periodOf(year: number, month: number, mode: FiscalYearMode) {
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  return {
    fiscalYear: fiscalYearOf(firstOfMonth, mode),
    index: monthIndexInFiscalYear(month, mode),
  };
}

/**
 * The years the picker offers.
 *
 * `/reports/periods` answers in *financial* years, and under the July–June
 * calendar each one spans two of the years a person would name — financial year
 * 2026 runs from July 2026 into June 2027. Both are offered, because a reader
 * looking for March 2027 will look for it under 2027.
 *
 * Nothing in the future: a year that has not started has no figures, and
 * offering it only invites an empty screen. The one exception is a year already
 * in the URL, which stays on the list so a shared link does not silently
 * resolve to a different period than the one that was sent.
 */
function calendarYears(
  fiscalYears: number[],
  mode: FiscalYearMode,
  thisYear: number,
  selected: number,
): number[] {
  const years = new Set<number>([thisYear, selected]);

  for (const fiscalYear of fiscalYears) {
    years.add(fiscalYear);
    if (mode === "bd_july_june") years.add(fiscalYear + 1);
  }

  return [...years]
    .filter((year) => year <= thisYear || year === selected)
    .sort((a, b) => b - a);
}

/** A month number, or null for anything that is not one. */
function monthParam(raw: string | string[] | undefined): number | null {
  const month = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

/** A plausible year, or null. Guards against `?year=0` and `?year=abcd`. */
function yearParam(raw: string | string[] | undefined): number | null {
  const year = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
}
