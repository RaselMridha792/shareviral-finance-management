import { monthRange, todayInDhaka } from "@finance/shared";

import { ExpensesScreen } from "@/components/expenses/expenses-screen";
import { ledgerApi } from "@/lib/ledger";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Expenses · SFM" };

export default async function ExpensesPage() {
  const today = todayInDhaka();
  const month = monthRange(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );

  const [summary, accounts, categories] = await Promise.all([
    ledgerApi.expenseSummary({ from: month.start, to: month.end }),
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return (
    <ExpensesScreen
      initialSummary={summary}
      initialRange={{ from: month.start, to: month.end, label: month.label }}
      accounts={accounts}
      categories={categories}
    />
  );
}
