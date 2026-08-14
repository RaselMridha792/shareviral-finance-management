import { monthRange, todayInDhaka } from "@finance/shared";

import { OtherExpensesScreen } from "@/components/expenses/other-expenses-screen";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Other expenses · SFM" };

/**
 * The whole vendor list used to be paged through here, just to work out which
 * rows to drop on the screen — the transactions endpoint had no way to say
 * "everything except tooling". It has one now (`excludeToolSpend`), built on
 * the same predicate the AI tools screen counts with, so the exclusion happens
 * where the definition lives and this page fetches nothing it does not render.
 */
export default async function OtherExpensesPage() {
  const today = todayInDhaka();
  const month = monthRange(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );

  const [accounts, categories] = await Promise.all([
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return (
    <OtherExpensesScreen
      initialRange={{ from: month.start, to: month.end, label: month.label }}
      accounts={accounts}
      categories={categories}
    />
  );
}
