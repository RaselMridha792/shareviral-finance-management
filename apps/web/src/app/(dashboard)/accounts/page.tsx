import { AccountsScreen } from "@/components/accounts/accounts-screen";
import { accountsApi } from "@/lib/masters";
import { fxApi } from "@/lib/reports";

export const dynamic = "force-dynamic";

export const metadata = { title: "Accounts · SFM" };

export default async function AccountsPage() {
  /**
   * The rate comes with the accounts, because each card shows what it holds
   * in both currencies — and for a USD-primary card, dollars first.
   *
   * The GOVERNING rate, not the rate table's newest row. The table is empty
   * on the live site while the Settings rate every report uses is not, and
   * reading the table here meant that rate never reached the cards: a dollar
   * account sat stated in taka with N/A underneath, which is exactly the
   * owner's complaint. (The table read was also behind settings.read, so for
   * most roles it failed quietly on top of being empty.)
   *
   * Null when nothing governs at all, and the cards then show N/A rather than
   * a figure. A translated amount produced from no rate is not an
   * approximation, it is an invention.
   */
  const [accounts, governing] = await Promise.all([
    accountsApi.list(true),
    fxApi.governing().catch(() => null),
  ]);

  return (
    <AccountsScreen
      initialAccounts={accounts}
      usdRate={governing?.rate ?? null}
    />
  );
}
