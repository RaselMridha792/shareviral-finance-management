"use client";

import { PAYMENT_METHOD_LABELS } from "@finance/shared";
import { Ban, Link2, Paperclip, SquarePen } from "lucide-react";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TransactionDto } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { DocumentsDialog } from "./documents-dialog";

/**
 * The ledger table. Used by five screens — the same rows, the same rules:
 * amounts right-aligned in mono with an explicit sign, voided rows struck
 * through but still present.
 *
 * The columns are switched rather than fixed, because the sheets this replaces
 * do not agree on them: All Transactions wants a Type column and no payment
 * method; Other Expenses wants the payment method and no Type, every row there
 * being money out. One table with two flags beats two tables that drift.
 */
export function TransactionTable({
  rows,
  onEdit,
  onVoid,
  showAccount = true,
  showBalance = false,
  showType = false,
  showPaymentMethod = false,
  emptyMessage = "Nothing recorded yet.",
}: {
  rows: (TransactionDto & { runningBalance?: string })[];
  onEdit?: (row: TransactionDto) => void;
  onVoid?: (row: TransactionDto) => void;
  showAccount?: boolean;
  showBalance?: boolean;
  /** Cash In / Cash Out as its own column, for the all-transactions view. */
  showType?: boolean;
  /**
   * Its own column instead of a line under the description. On where every row
   * is an expense and how it was paid is what people scan for.
   */
  showPaymentMethod?: boolean;
  emptyMessage?: string;
}) {
  const canWrite = useCan("transactions.write");
  const canVoid = useCan("transactions.void");
  /** Which entry's attachments are open. Set by clicking a reference. */
  const [documentsFor, setDocumentsFor] = useState<TransactionDto | null>(null);

  if (rows.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-data min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/50 text-left">
              <Th className="w-12 text-right">SL</Th>
              <Th className="w-24">Date</Th>
              {showType ? <Th className="w-24">Type</Th> : null}
              <Th className="w-40">Category</Th>
              <Th>Description</Th>
              <Th className="w-32">Reference</Th>
              {showPaymentMethod ? <Th className="w-32">Paid by</Th> : null}
              {showAccount ? <Th className="w-32">Account</Th> : null}
              <Th className="w-28 text-right">Amount (BDT)</Th>
              <Th className="w-28 text-right">Amount (USD)</Th>
              <Th className="w-20 text-right">Rate</Th>
              {showBalance ? <Th className="w-32 text-right">Balance</Th> : null}
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => {
              const voided = Boolean(row.voidedAt);

              /*
                Two different things can put dollars on a row, and only one of
                them is a fact.

                `originalCurrency === "USD"` means dollars were actually sent
                and the bank landed taka — the amount and the rate are both
                recorded, and the figure is exact. Everything else is the day's
                rate applied to a taka amount, which is a reading; it gets the
                tilde the rest of this app gives translations.

                A row with neither is left blank rather than converted at some
                other day's rate, which is the same rule the account cards
                follow.
              */
              const recordedInUsd = row.originalCurrency === "USD";
              const rate = recordedInUsd ? row.fxRate : row.usdRate;
              const usd = recordedInUsd
                ? signed(row.originalAmount, row.direction)
                : dividedBy(row.signedAmount, rate);

              return (
                <tr
                  key={row.id}
                  className={cn(
                    "row-finance hover:bg-surface-muted/50",
                    voided && "opacity-55",
                  )}
                >
                  {/*
                    A position in the list, not a stored number. The sheets
                    this replaces number their rows 1..n, and that is all this
                    is — it renumbers when the filter changes, which is correct,
                    because it was never an identifier. `refNo` is.
                  */}
                  <td className="num px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="num px-4 py-2.5 whitespace-nowrap">
                    {row.txnDate}
                  </td>
                  {showType ? (
                    <td className="px-4 py-2.5">
                      <Badge tone={row.direction === "in" ? "positive" : "negative"}>
                        {row.direction === "in" ? "Cash In" : "Cash Out"}
                      </Badge>
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5">
                    {row.categoryName ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: row.categoryColor ?? undefined }}
                        />
                        {row.categoryName}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="cell-prose px-4 py-2.5">
                    <span className={cn("font-medium", voided && "line-through")}>
                      {row.description}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {/*
                        Party used to be a column. It moved here when the
                        sketches asked for SL, Type, USD and Rate — thirteen
                        columns is a table nobody reads, and "who it was with"
                        belongs beside what it was for. Nothing is lost.
                      */}
                      {row.vendorName ?? row.counterparty ?? null}
                      {!showPaymentMethod ? (
                        <span>{PAYMENT_METHOD_LABELS[row.paymentMethod]}</span>
                      ) : null}
                      {row.transferGroupId ? <Badge>transfer</Badge> : null}
                      {Number(row.withheldTaxAmount) > 0 ? (
                        <Badge tone="warning">
                          tax withheld{" "}
                          <span className="num">{row.withheldTaxAmount}</span>
                        </Badge>
                      ) : null}
                      {row.originalAmount ? (
                        <Badge tone="primary">
                          <span className="num">
                            {row.originalCurrency} {row.originalAmount} @{" "}
                            {row.fxRate}
                          </span>
                        </Badge>
                      ) : null}
                      {voided ? (
                        <Badge tone="negative">
                          voided{row.voidReason ? `: ${row.voidReason}` : ""}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  {/*
                    The reference opens what is attached to the entry.

                    It shows the app's own ref, which every row has, with any
                    reference the person typed underneath. A cell that is
                    sometimes empty cannot be the thing you click, and the
                    sheets this replaces left that column blank on every row.
                  */}
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setDocumentsFor(row)}
                      title="Show the attached documents"
                      className="group cursor-pointer text-left"
                    >
                      <span className="num flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                        <Paperclip className="size-3" />
                        {row.refNo}
                      </span>
                      {row.reference ? (
                        <span className="num block text-xs text-muted-foreground">
                          {row.reference}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  {showPaymentMethod ? (
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                    </td>
                  ) : null}
                  {showAccount ? (
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.accountName ?? "—"}
                    </td>
                  ) : null}
                  {/*
                    Three cells where there was one, and the third is what
                    makes the second readable.

                    `showCounterpart` is off because the dollars now have a
                    column of their own — leaving it on would print them twice,
                    once under the taka and once beside it.
                  */}
                  <td className="px-4 py-2.5">
                    <Amount
                      value={row.signedAmount}
                      showSign
                      currency={row.currency}
                      showCounterpart={false}
                      tone={row.direction === "in" ? "in" : "out"}
                      className={cn("block font-semibold", voided && "line-through")}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    {usd ? (
                      <Amount
                        value={usd}
                        showSign
                        currency="USD"
                        approximate={!recordedInUsd}
                        showCounterpart={false}
                        tone={row.direction === "in" ? "in" : "out"}
                        className={cn("block", voided && "line-through")}
                      />
                    ) : (
                      <span
                        className="num block text-right text-xs text-muted-foreground"
                        title="No rate is recorded for this entry, so there is nothing to convert at. A figure here would be invented rather than approximate."
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-2.5 text-right text-xs text-muted-foreground">
                    {rate ?? "—"}
                  </td>
                  {showBalance ? (
                    <td className="col-amount px-4 py-2.5">
                      {row.runningBalance ? (
                        <Amount value={row.runningBalance} tone="neutral" />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {row.receiptUrl ? (
                        <a
                          href={row.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open the receipt"
                          className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-primary"
                        >
                          <Link2 className="size-3.5" />
                        </a>
                      ) : null}
                      {canWrite && onEdit && !voided ? (
                        <button
                          type="button"
                          onClick={() => onEdit(row)}
                          title="Edit"
                          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                        >
                          <SquarePen className="size-3.5" />
                        </button>
                      ) : null}
                      {canVoid && onVoid && !voided ? (
                        <button
                          type="button"
                          onClick={() => onVoid(row)}
                          title="Void"
                          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-negative"
                        >
                          <Ban className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.id}
          refNo={documentsFor.refNo}
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}
    </Card>
  );
}

/**
 * A taka string read as dollars at a rate, or null when there is no rate.
 *
 * Kept out of the component so it can be read on its own, and written to
 * return a string because money in this codebase is a string from
 * `numeric(14,2)` and never a float. This is the one place a division happens
 * in the browser, and it is allowed only because the result is explicitly a
 * translation — it is rendered with a tilde and its rate is in the next column.
 * Nothing is summed from it.
 */
function dividedBy(amount: string | null, rate: string | null): string | null {
  if (!amount || !rate) return null;
  const value = Number(amount);
  const divisor = Number(rate);
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) {
    return null;
  }
  return (value / divisor).toFixed(2);
}

/**
 * `originalAmount` is stored as a magnitude, like `amount`. The sign lives in
 * the direction, so a dollar figure shown beside a signed taka figure has to
 * be given the same sign or the two columns disagree on the same row.
 */
function signed(amount: string | null, direction: "in" | "out"): string | null {
  if (!amount) return null;
  const bare = amount.trim().replace(/^[+-]/, "");
  return direction === "out" ? `-${bare}` : bare;
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}
