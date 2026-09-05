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
  /* No category tree any more. The heading a subscription payment lands under
     is resolved on the server — it was always the same answer — so this page
     stopped fetching a list nothing on it reads. */
  /*
   * Both lists fall back to empty rather than taking the page down.
   *
   * HR may READ this register — the nav gates it on `vendors.read`, which HR
   * has — but has neither `accounts.read` nor `team.read`... it has the second
   * and not the first. So `accountsApi.list()` answered 403 and the whole
   * screen rendered "This page couldn't load. A server error occurred": a row
   * in the sidebar that leads to a crash.
   *
   * The lists only fill the pickers in the add/edit drawer, and a reader who
   * cannot write never opens it. An empty picker for somebody who cannot use
   * it is not a loss; a broken page is.
   */
  const [accounts, members] = await Promise.all([
    accountsApi.list().catch(() => []),
    teamApi
      .list({ page: 1, status: "active" })
      .catch(() => ({ items: [] as Awaited<ReturnType<typeof teamApi.list>>["items"] })),
  ]);

  return (
    <SubscriptionsScreen
      accounts={accounts}
      members={members.items}
    />
  );
}
