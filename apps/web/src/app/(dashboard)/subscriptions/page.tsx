import { SubscriptionsScreen } from "@/components/subscriptions/subscriptions-screen";
import { accountsApi } from "@/lib/masters";
import { teamApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

/**
 * The register of paid tools.
 *
 * Both master lists are fetched here rather than in the screen: they do not
 * change while somebody is filling in a form, and a client-side request behind
 * a drawer is a chance for the form to open before its pickers have anything
 * in them.
 *
 * There were three. The third was `vendors`, read only to suggest tool names
 * back when typing one here created a row in it. The names now come from the
 * plans the screen has already loaded, so there is nothing left to fetch.
 */
export default async function SubscriptionsPage() {
  const [accounts, members] = await Promise.all([
    accountsApi.list(),
    teamApi.list({ page: 1, status: "active" }),
  ]);

  return <SubscriptionsScreen accounts={accounts} members={members.items} />;
}
