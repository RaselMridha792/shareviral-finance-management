import { todayInDhaka } from "@finance/shared";

import { bankStatusApi } from "@/components/accounts/bank-status-api";
import { BankStatusScreen } from "@/components/accounts/bank-status-screen";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bank status · SFM" };

/**
 * Accounts ▸ Bank status: the boss's BANK STATUS table, one books month at a
 * time. Opens on the current month.
 *
 * A static segment under /accounts, so it wins over /accounts/[id], as
 * /accounts/cash-in does.
 */
export default async function BankStatusPage() {
  const month = `${todayInDhaka().slice(0, 7)}-01`;
  const initial = await bankStatusApi.month(month);

  return <BankStatusScreen initial={initial} />;
}
