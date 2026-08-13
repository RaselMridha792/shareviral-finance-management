import { SalarySheetScreen } from "@/components/payroll/salary-sheet-screen";
import { accountsApi } from "@/lib/masters";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export default async function PayrollRunPage({
  params,
}: PageProps<"/payroll/[runId]">) {
  const { runId } = await params;

  const [{ run, lines }, accounts] = await Promise.all([
    payrollApi.getRun(runId),
    accountsApi.list(),
  ]);

  return <SalarySheetScreen run={run} lines={lines} accounts={accounts} />;
}
