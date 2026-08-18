import { notFound } from "next/navigation";

import { AccountDetailScreen } from "@/components/accounts/account-detail-screen";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

/**
 * The account itself. The register — every entry against it — is one level
 * down at /accounts/[id]/register.
 *
 * The balance comes from the list rather than `accounts/:id`, because the list
 * is the endpoint that computes it and the dashboard reads the same one. A
 * second endpoint returning its own balance is a second answer to the same
 * question.
 */
export default async function AccountPage({
  params,
}: PageProps<"/accounts/[id]">) {
  const { id } = await params;

  const accounts = await accountsApi.list(true);

  const account = accounts.find((entry) => entry.id === id);
  if (!account) notFound();

  return <AccountDetailScreen account={account} />;
}
