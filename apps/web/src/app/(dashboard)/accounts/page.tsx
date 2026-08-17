import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { accountsApi } from "@/lib/masters";
import { fxApi } from "@/lib/reports";

export const dynamic = "force-dynamic";

export const metadata = { title: "Accounts · SFM" };

export default async function AccountsPage() {
  /**
   * The rate comes with the accounts, because each card now shows what it
   * holds in both currencies.
   *
   * Null when nothing has been recorded, and the cards then show a dash rather
   * than a figure. A translated amount produced from no rate is not an
   * approximation, it is an invention.
   */
  const [accounts, rates] = await Promise.all([
    accountsApi.list(true),
    fxApi.rates(1).catch(() => []),
  ]);

  return (
    <AccountsScreen
      initialAccounts={accounts}
      usdRate={rates[0]?.rate ?? null}
    />
  );
}
