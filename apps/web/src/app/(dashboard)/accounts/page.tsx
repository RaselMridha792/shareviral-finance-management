import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Accounts · SFM" };

export default async function AccountsPage() {
  const accounts = await accountsApi.list(true);
  return <AccountsScreen initialAccounts={accounts} />;
}
