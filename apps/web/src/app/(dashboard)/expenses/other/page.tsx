import {
  RECURRING_VENDOR_TYPES,
  monthRange,
  todayInDhaka,
} from "@finance/shared";

import { OtherExpensesScreen } from "@/components/expenses/other-expenses-screen";
import { accountsApi, categoriesApi, vendorsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Other expenses · SFM" };

export default async function OtherExpensesPage() {
  const today = todayInDhaka();
  const month = monthRange(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );

  const [accounts, categories, recurringVendorIds] = await Promise.all([
    accountsApi.list(),
    categoriesApi.tree(),
    recurringVendorIdsAsync(),
  ]);

  return (
    <OtherExpensesScreen
      initialRange={{ from: month.start, to: month.end, label: month.label }}
      accounts={accounts}
      categories={categories}
      recurringVendorIds={recurringVendorIds}
    />
  );
}

/**
 * The payees whose spending belongs on "AI tools and subscriptions" instead.
 *
 * The transactions endpoint filters by a single `vendorId`; it has no way to
 * say "everything except these vendor types", and the API belongs to another
 * stream right now — so the ids are resolved here and the rows are dropped in
 * the screen. Inactive payees are included: a cancelled subscription still has
 * this month's charge sitting in the ledger.
 */
async function recurringVendorIdsAsync(): Promise<string[]> {
  const recurringTypes = new Set<string>(RECURRING_VENDOR_TYPES);
  const ids: string[] = [];

  // pageSize is capped at 200, so a long payee list takes more than one pass.
  for (let page = 1; ; page += 1) {
    const result = await vendorsApi.list({
      page,
      pageSize: 200,
      includeInactive: true,
    });
    for (const vendor of result.items) {
      if (recurringTypes.has(vendor.type)) ids.push(vendor.id);
    }
    if (result.items.length === 0 || page >= result.totalPages) break;
  }

  return ids;
}
