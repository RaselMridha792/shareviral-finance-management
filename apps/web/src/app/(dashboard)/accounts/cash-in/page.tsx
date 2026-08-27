import { CashInScreen } from "@/components/accounts/cash-in-screen";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cash in · SFM" };

/**
 * Money arriving from abroad.
 *
 * A static segment under /accounts, so it wins over /accounts/[id] — nothing
 * can create an account whose id is "cash-in".
 */
export default async function CashInPage() {
  const accounts = await accountsApi.list();

  return <CashInScreen accounts={accounts} />;
}
