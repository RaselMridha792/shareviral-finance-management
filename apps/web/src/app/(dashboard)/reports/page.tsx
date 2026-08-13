import { todayInDhaka, type FinancialStatement } from "@finance/shared";

import { ReportsScreen } from "@/components/reports/reports-screen";
import { ApiError } from "@/lib/api-client";
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
  const index = current >= 0 ? current + 1 : 1;

  const [report, statement] = await Promise.all([
    reportsApi.period({
      granularity: "month",
      fiscalYear: periods.years[1],
      index,
    }),
    // The statement is one tab of four and must not decide whether the page
    // renders: if it cannot be built, the other three reports still open and
    // the statement tab says so itself.
    reportsApi
      .statement({
        granularity: "month",
        fiscalYear: periods.years[1],
        index,
      })
      .catch((caught: unknown): FinancialStatement | null => {
        // Only an API refusal is swallowed. `redirect()` throws a control-flow
        // signal Next unwinds, and catching that would strand an expired
        // session on a page it cannot render.
        if (!(caught instanceof ApiError)) throw caught;
        return null;
      }),
  ]);

  return (
    <ReportsScreen
      initialPeriods={periods}
      initialReport={report}
      initialStatement={statement}
    />
  );
}
