"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
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
        icon="description"
        description="One account's movements, in date order, with the balance after each."
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
        <TableScroll>
          <table className="table-data min-w-[900px] text-sm">
            <thead>
              {/* Seven columns: SL, Date, Description, then this table's own
                  subject — the two figures and the total they move — and the
                  reference last. Debit, Credit and Balance sit together
                  because that is the arithmetic a reader checks in one glance;
                  the Transaction ID used to be wedged between the description
                  and the debit, which broke that line of figures in half. */}
              <tr className="text-left">
                <SerialHead />
                <Th width="w-28">Date</Th>
                <Th>Description</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
                <Th align="right">Balance</Th>
                {/* The bank's own number for the line — what you quote back to
                    them, not what you read the statement by, so it sits after
                    the figures. It still opens the row's documents. */}
                <Th>Transaction ID</Th>
              </tr>
            </thead>
            <tbody>
              {/* The opening figure is a row, not a caption. A statement that
                  starts mid-air gives a reader no way to check the first
                  balance against anything. */}
              <tr className="row-finance bg-surface-muted/30">
                <td />
                <td className="num whitespace-nowrap">
                  {register.account.openingBalanceOn}
                </td>
                {/* 3: Description, Debit, Credit — the label runs up to the
                    balance it is the label for. */}
                <td className="text-muted-foreground" colSpan={3}>
                  Balance brought forward
                </td>
                <td className="text-right">
                  <Amount
                    value={register.openingBalance}
                    tone="neutral"
                    className="block font-medium"
                  />
                </td>
                {/* Transaction ID: an opening balance is not a movement, so it
                    has no reference of its own. */}
                <td />
              </tr>

              {register.rows.length === 0 ? (
                // 7: SL, Date, Description, Debit, Credit, Balance, Txn ID.
                <TableMessageRow colSpan={7}>
                  Nothing on this account in that period.
                </TableMessageRow>
              ) : (
                register.rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={cn("row-finance", row.voidedAt && "opacity-60")}
                  >
                    {/* Oldest first, and the serial counts with them: the
                        running balance is a window function over this order,
                        so neither the rows nor their numbering turn around. */}
                    <SerialCell n={index + 1} />
                    <td className="num whitespace-nowrap">{row.txnDate}</td>
                    <td className="cell-prose">
                      <span className={cn(row.voidedAt && "line-through")}>
                        {row.description}
                      </span>
                    </td>
                    <td className="text-right">
                      {row.direction === "out" ? (
                        <Amount
                          value={row.amount}
                          tone="out"
                          showCounterpart={false}
                          className="block"
                        />
                      ) : null}
                    </td>
                    <td className="text-right">
                      {row.direction === "in" ? (
                        <Amount
                          value={row.amount}
                          tone="in"
                          showCounterpart={false}
                          className="block"
                        />
                      ) : null}
                    </td>
                    <td className="text-right">
                      <Amount
                        value={row.runningBalance}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td>
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
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink">
                {/* 3: SL, Date, Description — the label reaches the first
                    figure it is the total of. */}
                <td colSpan={3}>
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Closing balance
                  </span>
                </td>
                <td className="text-right">
                  <Amount
                    value={register.totalOut}
                    tone="out"
                    showCounterpart={false}
                    className="block"
                  />
                </td>
                <td className="text-right">
                  <Amount
                    value={register.totalIn}
                    tone="in"
                    showCounterpart={false}
                    className="block"
                  />
                </td>
                <td className="text-right">
                  <Amount
                    value={register.closingBalance}
                    tone="neutral"
                    className="block font-semibold"
                  />
                </td>
                {/* Transaction ID: a total has no reference of its own. */}
                <td />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
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
