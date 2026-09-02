import { PayslipView } from "@/components/payroll/payslip-view";
import { listSignature } from "@/lib/api-client";
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

  const [payslip, settings, signatures] = await Promise.all([
    payrollApi.payslip(lineId),
    settingsApi.get(),
    // Never fatal. A payslip without the company's signature is still the
    // document; one that will not render because a file lookup failed is not.
    listSignature().catch(() => []),
  ]);

  return (
    <PayslipView
      payslip={payslip}
      settings={settings}
      /* Picked by KIND, not by position. One endpoint returns every file on
         the settings row, so `[0]` would hand whichever was uploaded first to
         both blocks — and the two are different people. */
      signature={
        signatures.find((one) => one.kind === "signature")?.id ?? null
      }
      preparedSignature={
        signatures.find((one) => one.kind === "prepared_signature")?.id ?? null
      }
    />
  );
}
