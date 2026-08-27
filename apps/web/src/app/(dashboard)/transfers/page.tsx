import { TransfersScreen } from "@/components/ledger/transfers-screen";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Money Transfer · SFM" };

export default async function TransfersPage() {
  // With balances: the form's pickers say what each account holds, which is
  // the warning that arrives before the never-below-zero refusal has to.
  const accounts = await accountsApi.list();

  return <TransfersScreen accounts={accounts} />;
}
