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

  const [breakdown, rows] = await Promise.all([
    ledgerApi.expenseSummary({ from, to, categorySlug: slug }),
    everyRowFor({ from, to, slug }),
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
      rows={rows}
      range={{ from, to, label: labelFor(from) }}
      accounts={accounts}
      categories={tree}
    />
  );
}

/** As many rows as the API will hand over in one request. Not a page size. */
const REQUEST_MAX = 200;

/**
 * Every entry the month put under this heading — all of them, not the first
 * two hundred.
 *
 * This asked for `pageSize: 200` and handed the answer straight to the table,
 * which meant a heading with a busy month stopped at row 200 and the two
 * hundred and first was not reachable from anywhere: no pager, no warning, no
 * hint that the list had ended early. Two hundred is the API's ceiling per
 * request and it is shared, so the fix is more requests rather than a bigger
 * one — the first reply says how many there are, and the rest are fetched
 * together. The table pages through what comes back at the app's `PAGE_SIZE`.
 */
async function everyRowFor({
  from,
  to,
  slug,
}: {
  from: string;
  to: string;
  slug: string;
}) {
  const query = { from, to, direction: "out" as const, categorySlug: slug };

  const first = await ledgerApi.list({ ...query, page: 1, pageSize: REQUEST_MAX });
  const pages = Math.ceil(first.total / REQUEST_MAX);
  if (pages <= 1) return first.items;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      ledgerApi.list({ ...query, page: i + 2, pageSize: REQUEST_MAX }),
    ),
  );
  return [...first.items, ...rest.flatMap((reply) => reply.items)];
}

function labelFor(from: string): string {
  const range = monthRange(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
  return range.label;
}
