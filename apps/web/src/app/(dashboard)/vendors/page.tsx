import { hasPermission } from "@finance/shared";

import { VendorsScreen } from "@/components/vendors/vendors-screen";
import { getSession } from "@/lib/api-client";
import { accountsApi, categoriesApi, vendorsApi } from "@/lib/masters";
import type { AccountDto, CategoryNode } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "AI tools and subscriptions · SFM" };

export default async function ToolsAndSubscriptionsPage() {
  const user = await getSession();

  /**
   * Accounts and categories are for Record payment, and only for that.
   *
   * They are asked for only by a role that can actually record one. HR holds
   * `vendors.read` and reaches this page from its own sidebar, but holds
   * neither `accounts.read` nor `transactions.write` — so fetching them
   * unconditionally 403'd and took the whole page down with a server error, on
   * a link HR is given. The list itself needs neither.
   */
  const canRecordPayment =
    hasPermission(user?.role, "transactions.write") &&
    hasPermission(user?.role, "accounts.read") &&
    hasPermission(user?.role, "categories.read");

  const [page, summary, accounts, categories] = await Promise.all([
    vendorsApi.list({ pageSize: 50, includeInactive: true }),
    vendorsApi.subscriptions(),
    canRecordPayment ? accountsApi.list() : Promise.resolve<AccountDto[]>([]),
    canRecordPayment
      ? categoriesApi.tree()
      : Promise.resolve<CategoryNode[]>([]),
  ]);

  return (
    <VendorsScreen
      initialPage={page}
      summary={summary}
      accounts={accounts}
      categories={categories}
    />
  );
}
