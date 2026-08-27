"use client";

import { formatMoney } from "@finance/shared";
import { ArrowRight, LoaderCircle, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/patterns";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransferRowDto } from "@/lib/ledger";
import type { AccountWithBalance } from "@/lib/masters";
import { serial } from "@/lib/pagination";
import { cn, formatDate } from "@/lib/utils";
import { TransferForm } from "./transfer-form";
import { VoidDialog, type VoidableTransaction } from "./void-dialog";

/**
 * Moving money between the company's own accounts, and the record of it.
 *
 * A transfer is stored as two ledger rows — an out and an in sharing a group
 * id — so each account's register matches its own bank statement. Every other
 * screen rightly shows the halves; this page shows the *event*: one row,
 * from → to, one amount. The doubled view is why "how much moved between our
 * accounts this month" was unanswerable anywhere before this.
 *
 * The pair behaves as one everywhere it can be touched: voiding either half
 * voids both, deleting sends both to the trash, restoring brings both back,
 * and the account rule — never below zero — watches the paying side. All of
 * that already lived in the API; this page is the door it was missing.
 */
export function TransfersScreen({
  accounts,
}: {
  accounts: AccountWithBalance[];
}) {
  const canWrite = useCan("transactions.write");

  const [rows, setRows] = useState<TransferRowDto[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  /** A failed load is not an empty history, and must not read as one. */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<TransferRowDto | null>(null);

  /*
   * Only the newest request may write the rows. Two quick clicks on the pager
   * fire two fetches, and the slower answer must not land on top of the page
   * the reader has already moved to.
   */
  const latest = useRef(0);

  const load = useCallback(async (target: number) => {
    const ticket = ++latest.current;
    try {
      const result = await ledgerApi.listTransfers(target);
      if (ticket !== latest.current) return;
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setPage(result.page);
      setLoadError(null);
    } catch (caught) {
      if (ticket !== latest.current) return;
      setLoadError(
        caught instanceof ApiError
          ? caught.message
          : "The transfers could not be read. Reload the page to try again.",
      );
    }
  }, []);

  useEffect(() => {
    // Reading on open is what an effect is for — the same exemption every
    // list screen in Settings takes, for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(1);
  }, [load]);

  const del = useRowDelete<TransferRowDto & { id: string }>({
    kind: "transaction",
    subject: "transfer",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.description}</span>
        <span className="text-xs text-muted-foreground">
          {row.fromAccountName} → {row.toAccountName} · {formatDate(row.txnDate)}{" "}
          · {formatMoney(row.amount)}
        </span>
      </div>
    ),
    consequences: (
      <p>
        Both halves go together — the money leaves this record on{" "}
        <span className="font-medium text-foreground">both</span> accounts, and
        both come back together from{" "}
        <span className="font-medium text-foreground">
          Settings &rarr; Trashed
        </span>
        . If the transfer really happened and was reversed,{" "}
        <span className="font-medium text-foreground">void it instead</span> —
        that keeps it on both registers, struck through.
      </p>
    ),
    onDone: () => void load(rows?.length === 1 && page > 1 ? page - 1 : page),
  });

  return (
    <>
      <PageHeader
        title="Money Transfer"
        icon="swap_horiz"
        description="Move money between the company's own accounts. Each transfer records an out and an in, so both registers match their bank statements."
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New transfer
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <Card className="px-6 py-8 text-sm text-negative">{loadError}</Card>
      ) : rows === null ? (
        <Card className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading…
        </Card>
      ) : rows !== null && rows.length === 0 && page === 1 ? (
        <Card>
          <EmptyState icon="swap_horiz" title="No transfers yet">
            When money moves between two of the company&rsquo;s accounts — the
            bank to petty cash, one bank to another — record it here rather
            than as an expense, and both registers stay right.
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <table className="table-data">
              <thead>
                <tr>
                  <SerialHead />
                  <Th width="w-28">Date</Th>
                  <Th>Description</Th>
                  <Th>From</Th>
                  <Th width="w-8">
                    <span className="sr-only">to</span>
                  </Th>
                  <Th>To</Th>
                  <Th align="right" width="w-36">
                    Amount (BDT)
                  </Th>
                  <Th>Reference</Th>
                  <RowActionsHead deletable={canWrite} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableMessageRow colSpan={9}>
                    Nothing on this page.
                  </TableMessageRow>
                ) : (
                  rows.map((row, index) => {
                    const voided = Boolean(row.voidedAt);
                    return (
                      <tr
                        key={row.outId}
                        className={cn(
                          "row-finance",
                          voided && "opacity-60 [&_td]:line-through",
                        )}
                      >
                        <SerialCell n={serial(page, index)} />
                        <td className="num whitespace-nowrap text-muted-foreground">
                          {row.txnDate}
                        </td>
                        <td>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {row.description}
                            </span>
                            <span className="num text-xs text-muted-foreground">
                              {row.refNo}
                              {voided ? " · voided" : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          <AccountCell
                            id={row.fromAccountId}
                            name={row.fromAccountName}
                          />
                        </td>
                        <td>
                          <ArrowRight
                            className="size-3.5 text-muted-foreground"
                            aria-hidden
                          />
                        </td>
                        <td>
                          <AccountCell
                            id={row.toAccountId}
                            name={row.toAccountName}
                          />
                        </td>
                        <td className="text-right">
                          <Amount
                            value={row.amount}
                            tone="neutral"
                            className="block font-medium"
                          />
                        </td>
                        <td className="num text-xs text-muted-foreground">
                          {row.reference ?? "—"}
                        </td>
                        <RowActions
                          /*
                            No edit, and that is a decision rather than a gap:
                            an edit endpoint touches one row, and changing half
                            a pair would leave the two accounts disagreeing —
                            the exact fault the pair exists to prevent. A wrong
                            transfer is voided or deleted and recorded again.
                          */
                          second="void"
                          onSecond={
                            canWrite && !voided
                              ? () => setVoiding(row)
                              : undefined
                          }
                          onDelete={
                            canWrite
                              ? () => del.ask({ ...row, id: row.outId })
                              : undefined
                          }
                        />
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="transfer"
        onPage={(next) => void load(next)}
      />

      <TransferForm
        open={creating}
        accounts={accounts}
        onClose={() => setCreating(false)}
        onSaved={() => load(1)}
      />
      {/*
        The void dialog wants a transaction; the out half carries the pair's
        identity and the API voids its twin with it — the same door the
        transactions screen uses.
      */}
      <VoidDialog
        transaction={voiding ? toVoidable(voiding) : null}
        onClose={() => setVoiding(null)}
        onVoided={() => load(page)}
      />
      {del.dialog}
    </>
  );
}

/**
 * The slice the void dialog reads, built from the pair's out half — the side
 * the money left, which is what the dialog's summary should show.
 */
function toVoidable(row: TransferRowDto): VoidableTransaction {
  return {
    id: row.outId,
    refNo: row.refNo,
    description: row.description,
    txnDate: row.txnDate,
    accountName: row.fromAccountName,
    signedAmount: `-${row.amount}`,
    currency: "BDT",
    direction: "out",
    transferGroupId: row.groupId,
  };
}

/** An account's name, a link like every other name in a table. */
function AccountCell({ id, name }: { id: string; name: string }) {
  return (
    <a
      href={`/accounts/${id}`}
      className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
    >
      {name}
    </a>
  );
}
