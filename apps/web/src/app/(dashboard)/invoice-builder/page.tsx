import { hasPermission } from "@finance/shared";
import { redirect } from "next/navigation";

import { InvoiceBuilder } from "@/components/invoice-builder/invoice-builder";
import { getSession } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Invoice Builder · SFM" };

/**
 * An invoice drawn and saved as a PDF — see `invoice-builder.tsx`.
 *
 * Gated on `transactions.write`, the people who put money into the books:
 * an invoice asks somebody for money on the company's behalf and prints its
 * bank account. The check is here rather than in `proxy.ts`'s route map,
 * because the page fetches nothing — there is no API refusal behind it to
 * fall back on, so the page is where the boundary is.
 */
export default async function InvoiceBuilderPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasPermission(user.role, "transactions.write")) {
    redirect("/no-access?from=/invoice-builder&needs=transactions.write");
  }
  return <InvoiceBuilder />;
}
