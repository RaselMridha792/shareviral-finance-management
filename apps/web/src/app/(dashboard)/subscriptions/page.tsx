import { SubscriptionsScreen } from "@/components/subscriptions/subscriptions-screen";
import { accountsApi, vendorsApi } from "@/lib/masters";
import { teamApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

/**
 * The register of paid tools.
 *
 * The three master lists are fetched here rather than in the screen: they do
 * not change while somebody is filling in a form, and three client-side
 * requests behind a drawer is three chances for the form to open before the
 * pickers have anything in them.
 */
export default async function SubscriptionsPage() {
  const [vendors, accounts, members] = await Promise.all([
    vendorsApi.list({ page: 1, pageSize: 200 }),
    accountsApi.list(),
    teamApi.list({ page: 1, status: "active" }),
  ]);

  return (
    <SubscriptionsScreen
      vendors={vendors.items}
      accounts={accounts}
      members={members.items}
    />
  );
}
