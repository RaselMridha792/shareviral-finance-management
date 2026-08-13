import { hasPermission } from "@finance/shared";
import type { Granularity, PendingItem } from "@finance/shared";

import { HrDashboard } from "@/components/dashboard/hr-dashboard";
import { OverviewScreen } from "@/components/dashboard/overview-screen";
import { getSession } from "@/lib/api-client";
import { reportsApi } from "@/lib/reports";
import { tdsApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

const GRANULARITIES = ["month", "quarter", "half", "year"] as const;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSession();
  const params = await searchParams;

  const asked = String(params.granularity ?? "month");
  const granularity: Granularity = (
    GRANULARITIES as readonly string[]
  ).includes(asked)
    ? (asked as Granularity)
    : "month";

  // HR signs in here too and holds none of the money permissions. Asking for
  // figures they may not see would 403 and take the whole page down, so the
  // decision is made before the request rather than after it.
  const seesMoney = hasPermission(user?.role, "dashboard.money");
  const seesTds = hasPermission(user?.role, "tds.read");

  // TDS deadlines only. The income tax screen was retired on the owner's
  // instruction, so nothing on this dashboard links to one — the records and
  // the /income-tax endpoints are still there, just not shown here.
  const pending: PendingItem[] = seesTds
    ? [...(await tdsApi.pending())].sort((a, b) =>
        a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0,
      )
    : [];

  if (!seesMoney) {
    return (
      <HrDashboard
        firstName={user?.fullName.split(" ")[0] ?? "there"}
        pending={pending}
      />
    );
  }

  // One request for the whole screen. It used to be one per account, before a
  // single figure appeared.
  // No currency parameter any more: the dashboard shows taka with the dollars
  // beside them, at the month's own funding rate.
  const report = await reportsApi.overview({ granularity });

  return (
    <OverviewScreen
      firstName={user?.fullName.split(" ")[0] ?? "there"}
      report={report}
      pending={pending}
    />
  );
}
