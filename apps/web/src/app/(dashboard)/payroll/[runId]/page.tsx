import { SalarySheetScreen } from "@/components/payroll/salary-sheet-screen";
import { accountsApi } from "@/lib/masters";
import { payrollApi } from "@/lib/payroll";
import { fxApi } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function PayrollRunPage({
  params,
}: PageProps<"/payroll/[runId]">) {
  const { runId } = await params;

  const [{ run, lines }, accounts, governing] = await Promise.all([
    payrollApi.getRun(runId),
    accountsApi.list(),
    // The sheet's FX Rate and Net Pay (USD) columns — the month's governing
    // rate, resolved the one way the app resolves it. Null when nothing
    // governs, and the columns then read N/A.
    fxApi.governing().catch(() => null),
  ]);

  return (
    <SalarySheetScreen
      run={run}
      lines={lines}
      accounts={accounts}
      usdRate={governing?.rate ?? null}
    />
  );
}
