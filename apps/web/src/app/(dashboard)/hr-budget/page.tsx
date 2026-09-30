import { redirect } from "next/navigation";

/**
 * HR Budget (#121) held two of the four money requests the HR portal sends;
 * HR Requests (#125) holds all four, on one page, and this address goes
 * there \u2014 on its budgets when a link asked for `?tab=budgets`, else on its
 * spends. Kept so the bell's older links and bookmarks still land.
 */
export default async function HrBudgetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  redirect(
    search.tab === "budgets"
      ? "/hr-requests?kind=budget&state=all"
      : "/hr-requests?kind=spend&state=all",
  );
}
