import { notFound } from "next/navigation";

import { AdviceScreen } from "@/components/payroll/bank-advice/advice-screen";
import { ApiError } from "@/lib/api-client";
import { bankAdviceApi } from "@/lib/bank-advice";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bank Advice · SFM" };

/** One bank advice: its payments, what is missing, and the downloads. */
export default async function BankAdviceDetailPage({
  params,
}: PageProps<"/payroll/bank-advice/[id]">) {
  const { id } = await params;
  const [advice, accounts] = await Promise.all([
    bankAdviceApi.get(id).catch((error: unknown) => {
      // One in the trash, or an id that never was, is not a server fault.
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 400)
      ) {
        return null;
      }
      throw error;
    }),
    accountsApi.list().catch(() => []),
  ]);
  if (!advice) notFound();

  return (
    <AdviceScreen
      key={advice.id}
      initial={advice}
      accounts={accounts.filter((account) => account.type === "bank")}
    />
  );
}
