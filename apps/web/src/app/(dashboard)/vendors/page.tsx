import { VendorsScreen } from "@/components/vendors/vendors-screen";
import { vendorsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Subscriptions · SFM" };

export default async function SubscriptionsPage() {
  const [page, summary] = await Promise.all([
    vendorsApi.list({ pageSize: 50, includeInactive: true }),
    vendorsApi.subscriptions(),
  ]);

  return <VendorsScreen initialPage={page} summary={summary} />;
}
