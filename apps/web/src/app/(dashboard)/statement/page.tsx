import Link from "next/link";

import { BankStatementScreen } from "@/components/reports/bank-statement-screen";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/patterns";
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

  /*
   * No accounts is not a missing page.
   *
   * This called `notFound()`, so a company that had not added its first
   * account yet — every company, on its first day — followed the link in its
   * own sidebar and was told the page does not exist. The link is right; there
   * is simply nothing to draw a statement of, and saying so is a different
   * sentence from 404.
   *
   * The two other `notFound()` calls in this app are the honest kind: a URL
   * naming an account or a category that does not exist really is a request
   * for something that is not there.
   */
  if (accounts.length === 0) {
    return (
      <>
        <PageHeader
          title="Bank statement"
          icon="description"
          description="One account's movements, in date order, with the balance after each."
        />
        <Card>
          <EmptyState
            icon="account_balance"
            title="No accounts yet"
            action={
              <Link
                href="/accounts"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Add an account
              </Link>
            }
          >
            A statement is one account&apos;s movements with the balance after
            each, so there has to be an account first — with the balance it
            held on the day you started, which every figure below it is built
            on.
          </EmptyState>
        </Card>
      </>
    );
  }

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
