import { redirect } from "next/navigation";

import { PayrollListScreen } from "@/components/payroll/payroll-list-screen";
import { payrollApi } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export const metadata = { title: "Payroll · SFM" };

export default async function PayrollPage({
  searchParams,
}: PageProps<"/payroll">) {
  const page = await payrollApi.listRuns();

  /*
   * Sent a month — Expense overview's Salary box sends the one it was read in
   * (the owner, 28 Oct 2026) — this opens that month's salary sheet, when
   * there is one. Without a sheet for it, the list, as before.
   */
  const search = await searchParams;
  if (
    typeof search.from === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(search.from)
  ) {
    const year = Number(search.from.slice(0, 4));
    const month = Number(search.from.slice(5, 7));
    const run = page.items.find(
      (r) => r.periodYear === year && r.periodMonth === month,
    );
    if (run) redirect(`/payroll/${run.id}`);
  }

  return <PayrollListScreen initialPage={page} />;
}
