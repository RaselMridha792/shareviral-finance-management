"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import type { RegisterResult, TransactionDto } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import { cn } from "@/lib/utils";

/**
 * The bank's own ledger, in the shape the owner's sheet has it.
 *
 * Debit and credit rather than one signed column: that is how a statement
 * reads, and it is the arrangement somebody ticks off against the bank's paper.
 * The running balance after each line is what makes it a statement rather than
 * a list — and it is why an account has to be chosen. A balance across two
 * accounts is not the balance of anything; adding Standard Chartered's rows to
 * the petty cash tin's produces a number no bank would recognise.
 *
 * Everything else the owner asked to keep out stays out: two dates, and no
 * currency switcher. Taka on the line, dollars small underneath, the same as
 * every other table here.
 */
export function BankStatementScreen({
  register,
  accounts,
  accountId,
  range,
}: {
  register: RegisterResult;
  accounts: AccountDto[];
  accountId: string;
  range: { from?: string; to?: string };
}) {
  const router = useRouter();
  const [documentsFor, setDocumentsFor] = useState<TransactionDto | null>(null);

  function go(next: { account?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    params.set("account", next.account ?? accountId);
    const from = next.from ?? range.from;
    const to = next.to ?? range.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/statement?${params}`);
  }

  return (
    <>
      <PageHeader
        title="Bank statement"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Account"
              value={accountId}
              onChange={(e) => go({ account: e.target.value })}
              className={cn(controlClass, "h-9 w-auto min-w-44")}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label="From"
              title="From"
              value={range.from ?? ""}
              onChange={(e) => go({ from: e.target.value })}
              className={cn(controlClass, "num h-9 w-auto")}
            />
            <input
              type="date"
              aria-label="To"
              title="To"
              value={range.to ?? ""}
              onChange={(e) => go({ to: e.target.value })}
              className={cn(controlClass, "num h-9 w-auto")}
            />
          </div>
        }
      />

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="table-data min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <Th className="text-right">SL</Th>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Transaction ID</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {/* The opening figure is a row, not a caption. A statement that
                  starts mid-air gives a reader no way to check the first
                  balance against anything. */}
              <tr className="row-finance bg-surface-muted/30">
                <td className="px-4 py-2.5" />
                <td className="num px-4 py-2.5 whitespace-nowrap">
                  {register.account.openingBalanceOn}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground" colSpan={4}>
                  Balance brought forward
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Amount
                    value={register.openingBalance}
                    currency={register.account.currency}
                    tone="neutral"
                    className="block font-medium"
                  />
                </td>
              </tr>

              {register.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    Nothing on this account in that period.
                  </td>
                </tr>
              ) : (
                register.rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "row-finance hover:bg-surface-muted/50",
                      row.voidedAt && "opacity-60",
                    )}
                  >
                    <td className="num px-4 py-2.5 text-right text-muted-foreground">
                      {index + 1}
                    </td>
                    <td className="num px-4 py-2.5 whitespace-nowrap">
                      {row.txnDate}
                    </td>
                    <td className="cell-prose px-4 py-2.5">
                      <span className={cn(row.voidedAt && "line-through")}>
                        {row.description}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Every movement is meant to carry its paper, so the
                          number that identifies it is what opens it. */}
                      <button
                        type="button"
                        onClick={() => setDocumentsFor(row)}
                        className="num cursor-pointer rounded-md px-1 py-0.5 transition hover:bg-surface-muted hover:text-primary"
                      >
                        {row.reference ?? row.refNo}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.direction === "out" ? (
                        <Amount
                          value={row.amount}
                          currency={register.account.currency}
                          tone="out"
                          showCounterpart={false}
                          className="block"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.direction === "in" ? (
                        <Amount
                          value={row.amount}
                          currency={register.account.currency}
                          tone="in"
                          showCounterpart={false}
                          className="block"
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Amount
                        value={row.runningBalance}
                        currency={register.account.currency}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink">
                <td className="px-4 py-3" colSpan={4}>
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Closing balance
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Amount
                    value={register.totalOut}
                    currency={register.account.currency}
                    tone="out"
                    showCounterpart={false}
                    className="block"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <Amount
                    value={register.totalIn}
                    currency={register.account.currency}
                    tone="in"
                    showCounterpart={false}
                    className="block"
                  />
                </td>
                <td className="px-4 py-3 text-right">
                  <Amount
                    value={register.closingBalance}
                    currency={register.account.currency}
                    tone="neutral"
                    className="block font-semibold"
                  />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Voided entries are shown struck through and left out of every total — a
        statement that hides a correction is the one an auditor is looking for.
      </p>

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.id}
          refNo={documentsFor.reference ?? documentsFor.refNo}
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}
    </>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}
