import { monthRange, todayInDhaka } from "@finance/shared";

import { ExpensesScreen } from "@/components/expenses/expenses-screen";
import { ledgerApi } from "@/lib/ledger";
import { categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Expenses · SFM" };

export default async function ExpensesPage() {
  const today = todayInDhaka();
  const month = monthRange(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );

  // No accounts here any more. They were only ever for the edit form under
  // the month's transaction table, and this screen no longer carries one —
  // the headings below are the page, and each has its own table.
  const [summary, categories] = await Promise.all([
    ledgerApi.expenseSummary({ from: month.start, to: month.end }),
    categoriesApi.tree(),
  ]);

  return (
    <ExpensesScreen
      initialSummary={summary}
      initialRange={{ from: month.start, to: month.end, label: month.label }}
      categories={categories}
    />
  );
}
