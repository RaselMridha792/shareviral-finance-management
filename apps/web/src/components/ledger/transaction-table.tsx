"use client";

import { PAYMENT_METHOD_LABELS } from "@finance/shared";
import { Ban, Link2, SquarePen } from "lucide-react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TransactionDto } from "@/lib/ledger";
import { cn } from "@/lib/utils";

/**
 * The ledger table. Used by /transactions and /expenses — the same rows, the
 * same rules: amounts right-aligned in mono with an explicit sign, voided rows
 * struck through but still present.
 */
export function TransactionTable({
  rows,
  onEdit,
  onVoid,
  showAccount = true,
  showBalance = false,
  emptyMessage = "Nothing recorded yet.",
}: {
  rows: (TransactionDto & { runningBalance?: string })[];
  onEdit?: (row: TransactionDto) => void;
  onVoid?: (row: TransactionDto) => void;
  showAccount?: boolean;
  showBalance?: boolean;
  emptyMessage?: string;
}) {
  const canWrite = useCan("transactions.write");
  const canVoid = useCan("transactions.void");

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
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted/50 text-left">
              <Th className="w-24">Date</Th>
              <Th className="w-32">Ref</Th>
              <Th>Description</Th>
              <Th className="w-40">Category</Th>
              <Th className="w-36">Party</Th>
              {showAccount ? <Th className="w-32">Account</Th> : null}
              <Th className="w-28 text-right">Amount</Th>
              {showBalance ? <Th className="w-32 text-right">Balance</Th> : null}
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const voided = Boolean(row.voidedAt);
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "row-finance hover:bg-surface-muted/50",
                    voided && "opacity-55",
                  )}
                >
                  <td className="num px-4 py-2.5 whitespace-nowrap">
                    {row.txnDate}
                  </td>
                  <td className="num px-4 py-2.5 text-xs text-muted-foreground">
                    {row.refNo}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("font-medium", voided && "line-through")}>
                      {row.description}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                      {row.reference ? (
                        <span className="num">· {row.reference}</span>
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
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {row.vendorName ?? row.counterparty ?? "—"}
                  </td>
                  {showAccount ? (
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.accountName ?? "—"}
                    </td>
                  ) : null}
                  <td className="px-4 py-2.5">
                    <Amount
                      value={row.amount}
                      showSign
                      tone={row.direction === "in" ? "in" : "out"}
                      className={cn("block font-semibold", voided && "line-through")}
                    />
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
    </Card>
  );
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
