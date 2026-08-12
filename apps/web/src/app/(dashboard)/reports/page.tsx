import { todayInDhaka } from "@finance/shared";

import { ReportsScreen } from "@/components/reports/reports-screen";
import { reportsApi } from "@/lib/reports";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports · SFM" };

export default async function ReportsPage() {
  const periods = await reportsApi.periods("month");

  // Open on the period we are actually in. Landing on July every August is the
  // kind of small wrongness that makes people stop trusting a report.
  const today = todayInDhaka();
  const current = periods.periods.findIndex(
    (p) => today >= p.start && today <= p.end,
  );

  const report = await reportsApi.period({
    granularity: "month",
    fiscalYear: periods.years[1],
    index: current >= 0 ? current + 1 : 1,
  });

  return <ReportsScreen initialPeriods={periods} initialReport={report} />;
}
