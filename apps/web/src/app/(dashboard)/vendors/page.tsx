import { VendorsScreen } from "@/components/vendors/vendors-screen";
import { accountsApi, categoriesApi, vendorsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "AI tools and subscriptions · SFM" };

export default async function ToolsAndSubscriptionsPage() {
  // Accounts and categories so a payment can be recorded against a tool
  // without leaving the screen — the link the subscriptions figures depend on.
  const [page, summary, accounts, categories] = await Promise.all([
    vendorsApi.list({ pageSize: 50, includeInactive: true }),
    vendorsApi.subscriptions(),
    accountsApi.list(),
    categoriesApi.tree(),
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
