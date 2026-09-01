import { SubscriptionScreen } from "@/components/subscriptions/subscription-screen";
import { subscriptionsApi } from "@/lib/subscriptions";

export const dynamic = "force-dynamic";

/**
 * One plan's own page.
 *
 * `GET /subscriptions/:id` already returns everything this needs, seats
 * included — the service selects the same 22 fields the list does and then
 * attaches the users. No API change was needed for this.
 */
export default async function SubscriptionPage({
  params,
}: PageProps<"/subscriptions/[id]">) {
  const { id } = await params;
  const plan = await subscriptionsApi.get(id);

  return <SubscriptionScreen plan={plan} />;
}
