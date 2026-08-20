import { monthRange, todayInDhaka } from "@finance/shared";
import { notFound } from "next/navigation";

import { CategoryDetailScreen } from "@/components/expenses/category-detail-screen";
import { ledgerApi } from "@/lib/ledger";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<"/expenses/[category]">) {
  const { category: slug } = await params;
  const search = await searchParams;

  const today = todayInDhaka();
  const fallback = monthRange(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );
  const from = typeof search.from === "string" ? search.from : fallback.start;
  const to = typeof search.to === "string" ? search.to : fallback.end;

  const [tree, accounts] = await Promise.all([
    categoriesApi.tree(true),
    accountsApi.list(),
  ]);

  const heading = tree.find((node) => node.slug === slug);
  if (!heading) notFound();

  const [breakdown, list] = await Promise.all([
    ledgerApi.expenseSummary({ from, to, categorySlug: slug }),
    ledgerApi.list({
      from,
      to,
      direction: "out",
      categorySlug: slug,
      page: 1,
      pageSize: 200,
    }),
  ]);

  return (
    <CategoryDetailScreen
      /*
       * Keyed by heading and month, so the screen is a fresh one when either
       * changes. The sub-category filter it holds belongs to the month it was
       * picked in — a client-side `router.push` to the same route would keep
       * the old one alive and scope August's table to a heading somebody was
       * reading in July.
       */
      key={`${heading.id}:${from}:${to}`}
      heading={heading}
      breakdown={breakdown}
      rows={list.items}
      range={{ from, to, label: labelFor(from) }}
      accounts={accounts}
      categories={tree}
    />
  );
}

function labelFor(from: string): string {
  const range = monthRange(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
  return range.label;
}
