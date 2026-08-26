"use client";

import { formatMoney } from "@finance/shared";

import { useRowDelete } from "@/components/ui/use-row-delete";
import type { TransactionDto } from "@/lib/ledger";
import { formatDate } from "@/lib/utils";

/**
 * Deleting a money row, worded the same way on all five screens that hold one.
 *
 * All transactions, the register, cash in, other expenses and a category's
 * page are the same rows seen from different angles, so the warning has to be
 * the same sentence — five copies would drift, and the one that drifts is the
 * one that stops mentioning voiding.
 *
 * That mention is the point of the text. Void and delete are both here, they
 * look alike in a row of icons, and only one of them is right for an entry
 * that genuinely happened. Saying so at the moment of choosing is worth more
 * than any amount of documentation.
 */
export function useTransactionDelete(onDone: () => void) {
  return useRowDelete<TransactionDto>({
    kind: "transaction",
    subject: "transaction",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.description}</span>
        <span className="text-xs text-muted-foreground">
          {row.refNo} · {formatDate(row.txnDate)} ·{" "}
          {row.direction === "in" ? "in" : "out"} {formatMoney(row.amount)}
        </span>
      </div>
    ),
    consequences: (
      <p>
        It leaves this list and every total in the app — the dashboard, the
        reports, the account balance. You can put it back from{" "}
        <span className="font-medium text-foreground">
          Settings &rarr; Trashed
        </span>{" "}
        until the trash is emptied. If the entry really happened and was
        reversed,{" "}
        <span className="font-medium text-foreground">void it instead</span> —
        that keeps it on the ledger, struck through, where an auditor can see
        it.
      </p>
    ),
    onDone,
  });
}
