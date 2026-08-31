import { SalarySheetScreen } from "@/components/payroll/salary-sheet-screen";
import { accountsApi } from "@/lib/masters";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export default async function PayrollRunPage({
  params,
}: PageProps<"/payroll/[runId]">) {
  const { runId } = await params;

  /*
   * No FX call. The sheet's FX Rate column used to be the app's one governing
   * rate printed on every row; every line now carries the rate it was read in
   * dollars at, so there is nothing to resolve here.
   */
  const [{ run, lines }, accounts] = await Promise.all([
    payrollApi.getRun(runId),
    accountsApi.list(),
  ]);

  return <SalarySheetScreen run={run} lines={lines} accounts={accounts} />;
}
