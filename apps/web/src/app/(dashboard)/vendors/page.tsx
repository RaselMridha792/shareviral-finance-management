import { VendorsScreen } from "@/components/vendors/vendors-screen";
import { vendorsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Vendors · SFM" };

export default async function VendorsPage() {
  const page = await vendorsApi.list({ pageSize: 50, includeInactive: true });
  return <VendorsScreen initialPage={page} />;
}
