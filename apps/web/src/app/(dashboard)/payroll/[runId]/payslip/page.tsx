import { PayslipView } from "@/components/payroll/payslip-view";
import { settingsApi } from "@/lib/masters";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

/**
 * `runId` here carries the payroll **line** id — one payslip is one person's
 * line, and the route reads more naturally than /payroll/lines/[id].
 */
export default async function PayslipPage({
  params,
}: PageProps<"/payroll/[runId]/payslip">) {
  const { runId: lineId } = await params;

  const [payslip, settings] = await Promise.all([
    payrollApi.payslip(lineId),
    settingsApi.get(),
  ]);

  return <PayslipView payslip={payslip} settings={settings} />;
}
