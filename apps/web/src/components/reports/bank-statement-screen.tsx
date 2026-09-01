"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney } from "@finance/shared";

import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import {
  DateRangeField,
  FilterBar,
  FilterSelect,
} from "@/components/ui/filters";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import type { RegisterResult, TransactionDto } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import { PAGE_SIZE, pageCount, serial } from "@/lib/pagination";
import { formatDate, cn } from "@/lib/utils";

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
  const [page, setPage] = useState(1);

  /**
   * Oldest first, the way a bank's own paper reads.
   *
   * This screen used to reverse the API's order to put the newest movement on
   * top. The owner asked for it back — "bank statement er ordering oldest first
   * kore diyo" — and he is right for the reason the Balance column exists: that
   * figure is a running total, and a running total read downwards from the
   * newest counts backwards. Every statement a bank issues, and every one this
   * page is reconciled against, starts at the brought-forward figure and works
   * down.
   *
   * So the rows are taken as the API sends them. The API orders ascending
   * because the balance is a window function over exactly that order — which is
   * now also the order they are shown in, and the two agreeing is the point.
   * The SL column already counts oldest = 1.
   */
  const ordered = register.rows;

  const totalPages = pageCount(ordered.length);
  /*
   * Clamped rather than reset.
   *
   * The account and the two dates are the only things that shorten this list,
   * and each of them already sends the reader back to page 1 through `go`. The
   * clamp is for what a filter change cannot do anything about — a page number
   * that outlives the rows it pointed at, which draws an empty table on a
   * statement that plainly has movements in it.
   */
  const current = Math.min(page, totalPages);
  const visible = ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  /**
   * Every control writes the whole query rather than a patch of it.
   *
   * This screen's state is the URL — the account and the two dates are query
   * parameters and the page re-renders on the server from them, which is what
   * lets a statement somebody is reading be sent to somebody else and open on
   * the same page. So a filter change is a navigation, and the navigation has
   * to carry all three.
   *
   * It used to fall back field by field with `??`, which held only while a
   * cleared date arrived as "". The range control reports a cleared end as
   * `undefined`, and `undefined ?? range.from` would have read "cleared" as
   * "unchanged" and put the old date straight back. Passing the full triple
   * removes the question; the query string built from it is unchanged.
   */
  function go(next: { account: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    params.set("account", next.account);
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    /*
     * Another account, or a narrower month, is a different and usually shorter
     * statement — and page 6 of it may not exist. The route does not change
     * here, only its query, so React keeps this component and its page number
     * alive across the navigation unless it is put back.
     */
    setPage(1);
    router.push(`/statement?${params}`);
  }

  return (
    <>
      <PageHeader
        title="Bank statement"
        icon="description"
        description="One account's movements, oldest first, with the balance after each."
      />

      {/*
        The filters below the title, above the table they decide.

        They were in the header's actions slot, which is where a screen puts
        what acts on it — New, Export — not what chooses its contents. Every
        other screen in the app carries this row directly above its table, and
        a reader who learnt where to look for it on Transactions was looking in
        the wrong place here. Nothing about the filtering changed; only where
        the row sits and which components draw it.

        Account first, and it has no "all" option: a running balance is the
        balance of one account, so this is the question the table cannot be
        read without an answer to. The dates narrow what it has already chosen.
      */}
      <FilterBar>
        {/* `wide` because the options come from the database — an account named
            after its bank and its branch would otherwise size the control to
            itself. */}
        <FilterSelect
          label="Account"
          value={accountId}
          onChange={(account) => go({ account, ...range })}
          wide
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </FilterSelect>

        {/* One bordered control with a hairline between the ends, not two
            boxes: the rule is what says these are the ends of a range. The
            labels ride on the inputs — a caption above each is what made rows
            like this two lines high. */}
        <DateRangeField
          from={range.from}
          to={range.to}
          onChange={(next) => go({ account: accountId, ...next })}
        />
      </FilterBar>

      <Card className="overflow-hidden p-0">
        {/*
          Where the balance starts, said above the rows rather than inside them.

          This was the table's first row, and it was the only row with no
          serial, no date of its own doing, no debit and no credit — an empty
          line that looked like a movement somebody had failed to fill in. The
          figure is not dummy data and cannot simply go: it is what the account
          held the day before the range opens, and every balance in the column
          below is built on it. So it leaves the rows and becomes their
          preamble, which is also how a bank prints it.
        */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-4 py-3">
          <span className="text-sm font-medium">
            {register.account.bankName ?? register.account.name}
            {range.from ? (
              <span className="text-muted-foreground">
                {" · "}
                <span className="num">{formatDate(range.from)}</span>
                {range.to ? (
                  <>
                    {" → "}
                    <span className="num">{formatDate(range.to)}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted-foreground">
            Brought forward at{" "}
            <span className="num">
              {formatDate(register.account.openingBalanceOn)}
            </span>
            {" — "}
            <span className="num font-medium text-ink">
              {formatMoney(register.openingBalance, { currency: "BDT" })}
            </span>
          </span>
        </div>

        <TableScroll>
          <table className="table-data min-w-[1000px] text-sm">
            <thead>
              {/* Nine columns: SL, Date, Description, then this table's own
                  subject — the two figures and the total they move — the
                  reference, and the actions. Debit, Credit and Balance sit
                  together because that is the arithmetic a reader checks in one
                  glance; the Transaction ID used to be wedged between the
                  description and the debit, which broke that line of figures in
                  half. The action pair goes last, where it goes on every
                  table. */}
              <tr className="text-left">
                <SerialHead />
                <Th width="w-28">Date</Th>
                <Th>Description</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
                <Th align="right">Balance</Th>
                {/*
                  "Entry No." — this app's number for the line, with the bank's
                  underneath when there is one.

                  It used to print `reference ?? refNo` under the heading
                  "Reference": the bank's number when one had been typed, and
                  ours when one had not, with nothing to say which you were
                  looking at. Two facts under one word, and no way to tell them
                  apart on the row that matters.
                */}
                <Th>Entry No.</Th>
                {/* The paper behind the movement. Every entry can carry one,
                    and the two references sit together because a reader
                    matching this statement against a file is looking for
                    either. */}
                <Th>Invoice</Th>
                <RowActionsHead />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                // 9: SL, Date, Description, Debit, Credit, Balance, Txn ID,
                // Invoice, actions.
                <TableMessageRow colSpan={9}>
                  Nothing on this account in that period.
                </TableMessageRow>
              ) : (
                visible.map((row, index) => (
                  <tr
                    key={row.id}
                    /*
                      The whole row carries the direction, the same as the
                      transactions table — the owner asked for both screens to
                      read alike. A tint rather than a fill so the figures stay
                      the loudest thing; a voided row loses it entirely, since
                      it is out of every total and colouring it would say it
                      still counts.
                    */
                    className={cn(
                      "row-finance",
                      row.voidedAt
                        ? "opacity-60"
                        : row.direction === "in"
                          /* The row's text as well as its tint — the same pair
                             the transactions table uses, so the two screens
                             cannot drift into two ideas of what green means. */
                          ? "row-in"
                          : "row-out",
                    )}
                  >
                    {/* Counted across the statement rather than within the
                        page: `index + 1` restarts at 1 on page two, so the
                        twenty-first movement and the first would answer to the
                        same number — on the screen whose numbers get read down
                        a phone to a bank. Number 1 is the newest line, and
                        every page continues where the last one stopped. */}
                    <SerialCell n={serial(current, index)} />
                    <td className="num whitespace-nowrap">
                      {formatDate(row.txnDate)}
                    </td>
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
                        className="num cursor-pointer rounded-md px-1 py-0.5 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
                      >
                        {row.refNo}
                      </button>
                      {row.reference ? (
                        <span className="num block text-xs text-muted-foreground">
                          {row.reference}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {row.invoiceNo ? (
                        <button
                          type="button"
                          onClick={() => setDocumentsFor(row)}
                          className="num cursor-pointer rounded-md px-1 py-0.5 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
                        >
                          {row.invoiceNo}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </td>
                    {/* The statement is read-only today — nothing on this
                        screen edits or voids a movement. The pair still renders,
                        disabled, so the column reads as "not from here" rather
                        than as a cell that failed to draw. */}
                    <RowActions second="void" />
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
                  </span>{" "}
                  {/* Said out loud now that the table pages: this line is the
                      whole period, and it sits under whichever twenty rows are
                      on screen. Without the qualifier a reader on page 3 has
                      every reason to read it as page 3's total. */}
                  <span className="text-xs text-muted-foreground">
                    · whole period, not this page
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
                {/* Transaction ID, Invoice and actions: a total has no
                    references of its own, and nothing about it is editable. */}
                <td />
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      </Card>

      {/* A sibling of the card, never inside the empty branch above — the page
          somebody most needs this control on is the one that came up empty, and
          a pager written in the table's branch is the one that is not there.
          It draws nothing at all while a statement fits on one page. */}
      <Pagination
        page={current}
        totalPages={totalPages}
        total={ordered.length}
        noun="entry"
        nounPlural="entries"
        onPage={setPage}
      />

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
