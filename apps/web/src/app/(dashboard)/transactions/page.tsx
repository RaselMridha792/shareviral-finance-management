import { TransactionsScreen } from "@/components/ledger/transactions-screen";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Transactions · SFM" };

export default async function TransactionsPage() {
  const [accounts, categories] = await Promise.all([
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return <TransactionsScreen accounts={accounts} categories={categories} />;
}
