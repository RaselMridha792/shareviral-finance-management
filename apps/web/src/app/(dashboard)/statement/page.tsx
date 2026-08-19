import { notFound } from "next/navigation";

import { BankStatementScreen } from "@/components/reports/bank-statement-screen";
import { ledgerApi } from "@/lib/ledger";
import { accountsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Bank statement · SFM" };

/**
 * The bank's own ledger for one account.
 *
 * One account, because the running balance is the point and a balance across
 * two accounts is the balance of nothing. Which one is in the URL rather than
 * in component state, so a statement somebody is reading can be sent to
 * somebody else and open on the same page.
 *
 * Voided rows are asked for on purpose: this is the page an auditor reads, and
 * a correction that leaves no trace on it is exactly what an audit looks for.
 * They do not touch the running balance — the window sum skips them.
 */
export default async function BankStatementPage({
  searchParams,
}: PageProps<"/statement">) {
  const search = await searchParams;
  const from = typeof search.from === "string" ? search.from : undefined;
  const to = typeof search.to === "string" ? search.to : undefined;

  const accounts = await accountsApi.list();
  if (accounts.length === 0) notFound();

  const asked = typeof search.account === "string" ? search.account : undefined;
  const account =
    accounts.find((entry) => entry.id === asked) ??
    // A bank first when nothing is asked for: this is a bank statement, and
    // opening on the petty cash tin would be answering a different question.
    accounts.find((entry) => entry.type === "bank") ??
    accounts[0];

  const register = await ledgerApi.register(account.id, {
    from,
    to,
    includeVoided: true,
  });

  return (
    <BankStatementScreen
      register={register}
      accounts={accounts}
      accountId={account.id}
      range={{ from, to }}
    />
  );
}
