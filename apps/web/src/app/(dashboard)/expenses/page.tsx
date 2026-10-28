import { monthRange, todayInDhaka } from "@finance/shared";

import { ExpensesScreen } from "@/components/expenses/expenses-screen";
import { ledgerApi } from "@/lib/ledger";
import { categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Expenses · SFM" };

export default async function ExpensesPage({
  searchParams,
}: PageProps<"/expenses">) {
  /*
   * The month asked for, else this one. Expense overview's boxes send the
   * month they were read in (28 Oct 2026), so May there opens May here.
   */
  const search = await searchParams;
  const asked =
    typeof search.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.from)
      ? search.from
      : todayInDhaka();
  const month = monthRange(
    Number(asked.slice(0, 4)),
    Number(asked.slice(5, 7)),
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
