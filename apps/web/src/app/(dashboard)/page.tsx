import { hasPermission } from "@finance/shared";
import type { CurrencyView, Granularity, PendingItem } from "@finance/shared";

import { HrDashboard } from "@/components/dashboard/hr-dashboard";
import { OverviewScreen } from "@/components/dashboard/overview-screen";
import { getSession } from "@/lib/api-client";
import { reportsApi } from "@/lib/reports";
import { incomeTaxApi, tdsApi } from "@/lib/tax";

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
  const seesUsd = hasPermission(user?.role, "reports.usd");
  const seesTds = hasPermission(user?.role, "tds.read");
  const seesIncomeTax = hasPermission(user?.role, "incometax.read");

  const currency: CurrencyView =
    seesUsd && params.currency === "USD" ? "USD" : "BDT";

  const pending: PendingItem[] = (
    await Promise.all([
      seesTds ? tdsApi.pending() : Promise.resolve([]),
      seesIncomeTax ? incomeTaxApi.pending() : Promise.resolve([]),
    ])
  )
    .flat()
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

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
  const report = await reportsApi.overview({ granularity, currency });

  return (
    <OverviewScreen
      firstName={user?.fullName.split(" ")[0] ?? "there"}
      report={report}
      pending={pending}
      canSeeUsd={seesUsd}
    />
  );
}
