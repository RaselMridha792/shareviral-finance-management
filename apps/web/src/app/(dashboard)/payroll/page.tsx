import { PayrollListScreen } from "@/components/payroll/payroll-list-screen";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payroll · SFM" };

export default async function PayrollPage() {
  const page = await payrollApi.listRuns();
  return <PayrollListScreen initialPage={page} />;
}
