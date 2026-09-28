import { hasPermission } from "@finance/shared";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getSession } from "@/lib/api-client";

export const dynamic = "force-dynamic";

/**
 * Every invoice page — All invoices, Add New, an invoice's own — is on
 * `transactions.write`, as every invoice route in the API is: an invoice asks
 * for money on the company's behalf and prints its bank account, and the
 * owner keeps it to the super admin and the CFO (28 Sep 2026).
 *
 * Here rather than in `proxy.ts`'s route map: the builder's pages fetch
 * little or nothing before they draw, so there is no API refusal behind them
 * to fall back on, and a change to the proxy is a change to the gate every
 * page passes through.
 */
export default async function InvoicesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasPermission(user.role, "transactions.write")) {
    redirect("/no-access?from=/invoices&needs=transactions.write");
  }
  return children;
}
