import { todayInDhaka } from "@finance/shared";

import { WithholdingScreen } from "@/components/tax/withholding-screen";
import { accountsApi } from "@/lib/masters";
import { tdsApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

export const metadata = { title: "Withholding tax · SFM" };

export default async function WithholdingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const today = todayInDhaka();
  const year = Number(yearParam) || Number(today.slice(0, 4));

  // The income year starts in July, so a date in Jan–Jun still belongs to the
  // year that began the previous July.
  const month = Number(today.slice(5, 7));
  const fiscalYear = month >= 7 ? year : year - 1;

  const [liability, deposits, returns, accounts] = await Promise.all([
    tdsApi.liability(year),
    tdsApi.deposits(year),
    tdsApi.returns(fiscalYear),
    accountsApi.list(),
  ]);

  return (
    <WithholdingScreen
      year={year}
      fiscalYear={fiscalYear}
      liability={liability}
      deposits={deposits}
      returns={returns}
      accounts={accounts}
    />
  );
}
