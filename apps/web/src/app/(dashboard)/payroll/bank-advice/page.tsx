import { AdviceListScreen } from "@/components/payroll/bank-advice/advice-list-screen";
import { accountsApi } from "@/lib/masters";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bank Advice · SFM" };

/**
 * The payment files for the bank (#119). Under /payroll, so the route map
 * already gates it on `payroll.read` like the salary sheets it comes from.
 *
 * The sheets and the accounts are for the New drawers only, and fall back to
 * empty rather than taking the page down for a reader who cannot build one.
 */
export default async function BankAdvicePage() {
  const [runs, accounts] = await Promise.all([
    payrollApi.listRuns().catch(() => null),
    accountsApi.list().catch(() => []),
  ]);
  return (
    <AdviceListScreen
      runs={runs?.items ?? []}
      accounts={accounts.filter((account) => account.type === "bank")}
    />
  );
}
