import { hasPermission } from "@finance/shared";
import { redirect } from "next/navigation";

import { HrBudgetScreen } from "@/components/hr-budget/hr-budget-screen";
import { getSession } from "@/lib/api-client";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "HR Budget · SFM" };

/**
 * What the HR portal sends finance (#121). Gated here on `hrbudget.read`: the
 * route map in `proxy.ts` is the gate every page passes through, and a new
 * page's check does not need to be a change to it.
 *
 * The accounts and headings are for paying a spend only, and fall back to
 * empty for a reader who cannot pay.
 */
export default async function HrBudgetPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasPermission(user.role, "hrbudget.read")) {
    redirect("/no-access?from=/hr-budget&needs=hrbudget.read");
  }
  const canPay =
    hasPermission(user.role, "hrbudget.manage") &&
    hasPermission(user.role, "transactions.write");
  const [accounts, categories] = canPay
    ? await Promise.all([
        accountsApi.list().catch(() => []),
        categoriesApi.tree().catch(() => []),
      ])
    : [[], []];

  return (
    <HrBudgetScreen
      accounts={accounts.filter(
        (account) => account.type === "bank" || account.type === "cash",
      )}
      categories={categories}
    />
  );
}
