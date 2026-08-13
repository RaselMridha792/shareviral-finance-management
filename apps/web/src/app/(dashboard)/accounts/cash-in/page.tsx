import { CashInScreen } from "@/components/accounts/cash-in-screen";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cash in · SFM" };

/**
 * Money arriving from abroad.
 *
 * A static segment under /accounts, so it wins over /accounts/[id] — nothing
 * can create an account whose id is "cash-in".
 */
export default async function CashInPage() {
  const [accounts, categories] = await Promise.all([
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return <CashInScreen accounts={accounts} categories={categories} />;
}
