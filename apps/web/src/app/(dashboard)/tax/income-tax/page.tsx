import { todayInDhaka } from "@finance/shared";

import { IncomeTaxScreen } from "@/components/tax/income-tax-screen";
import { accountsApi } from "@/lib/masters";
import { incomeTaxApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

export const metadata = { title: "Income tax · SFM" };

export default async function IncomeTaxPage() {
  const today = todayInDhaka();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // Bangladesh's income year runs July to June.
  const fiscalYear = month >= 7 ? year : year - 1;

  const [data, accounts] = await Promise.all([
    incomeTaxApi.list(),
    accountsApi.list(),
  ]);

  return (
    <IncomeTaxScreen data={data} fiscalYear={fiscalYear} accounts={accounts} />
  );
}
