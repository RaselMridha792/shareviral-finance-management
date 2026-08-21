import { todayInDhaka, type FinancialStatement } from "@finance/shared";

import { StatementScreen } from "@/components/reports/statement-screen";
import { ApiError } from "@/lib/api-client";
import { reportsApi } from "@/lib/reports";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports · SFM" };

export default async function StatementPage() {
  const periods = await reportsApi.periods("month");

  // Open on the period we are actually in. Landing on July every August is the
  // kind of small wrongness that makes people stop trusting a document.
  const today = todayInDhaka();
  const current = periods.periods.findIndex(
    (p) => today >= p.start && today <= p.end,
  );
  const index = current >= 0 ? current + 1 : 1;

  /**
   * A statement that cannot be built must not take the page down with it.
   *
   * The screen renders its own labelled sample in that case, loudly, rather
   * than showing an error where a document should be — and the other three
   * period lengths are still reachable from their tabs.
   */
  const statement = await reportsApi
    .statement({
      granularity: "month",
      /*
       * The year the periods above belong to, which is the newest one.
       *
       * This read `years[1]`, and `availablePeriods` returns its years newest
       * first while listing the periods of `currentFiscalYear` — so the index
       * was counted against this year's months and then applied to last
       * year's. Every visit opened on the same month a year ago, which holds
       * nothing, and the page greeted everybody with "0 line items".
       *
       * `Math.max` rather than `years[0]`: an index is only right while the
       * order is, and the order is not this file's to know. If the list is
       * ever returned the other way round, this still asks for the year the
       * months were counted in.
       */
      fiscalYear: Math.max(...periods.years),
      index,
    })
    .catch((caught: unknown): FinancialStatement | null => {
      // Only an API refusal is swallowed. `redirect()` throws a control-flow
      // signal Next unwinds, and catching that would strand an expired session
      // on a page it cannot render.
      if (!(caught instanceof ApiError)) throw caught;
      return null;
    });

  return (
    <StatementScreen
      initialStatement={statement}
      initialPeriods={periods}
      initialIndex={index}
    />
  );
}
