"use client";

import { PAYMENT_METHOD_LABELS } from "@finance/shared";
import { Link2, Paperclip, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableScroll,
  Th,
  TickCell,
  TickHead,
} from "@/components/ui/table";
import type { TransactionDto } from "@/lib/ledger";
import { serial } from "@/lib/pagination";
import { formatDate, cn } from "@/lib/utils";
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
 *
 * The account is on by default, and the one screen that tried living without
 * it asked for it back the same day. Which account a movement touched turns out
 * to be part of reading the row, not a detail belonging only to the register —
 * so it is opt-out, and only the register turns it off, because a register is
 * one account and names it in its heading.
 *
 * The order is the owner's, and it is the order every table in this app now
 * follows: SL, date, what happened, what it was filed under, the money, the
 * banking detail, then the numbers a document is found by. Reading two of
 * these screens side by side should not mean learning two layouts.
 */
export function TransactionTable({
  rows,
  page = 1,
  onEdit,
  onVoid,
  onDelete,
  bulk,
  showAccount = true,
  showBalance = false,
  showType = false,
  showPaymentMethod = false,
  emptyMessage = "Nothing recorded yet.",
}: {
  rows: (TransactionDto & { runningBalance?: string })[];
  /**
   * Which page of a larger list `rows` is, so the SL column can keep counting.
   *
   * 1-based, and 1 by default — a caller that hands over its whole list numbers
   * from 1 exactly as it did before this existed. A caller that pages passes
   * the page it sliced, because `index + 1` restarts at 1 on page two and two
   * different entries then answer to the same number. On these screens that
   * number is what somebody reads down a phone.
   */
  page?: number;
  onEdit?: (row: TransactionDto) => void;
  onVoid?: (row: TransactionDto) => void;
  /**
   * Opens the confirmation that sends the row to the trash.
   *
   * Passed by the screens that own a list they can reload; the bank statement
   * and the register read from elsewhere and leave it off, so their rows keep
   * the pair they had. A voided row can still be deleted — voiding says the
   * movement was reversed, deleting says it should never have been typed, and
   * the second is a fair thing to conclude about a row already struck through.
   */
  onDelete?: (row: TransactionDto) => void;
  /*
   * Selection, when the screen offers it. Undefined renders exactly as before,
   * which is what lets the bank statement — same component, no delete — keep
   * its shape.
   */
  bulk?: {
    isTicked: (id: string) => boolean;
    toggle: (id: string) => void;
    allOnPage: () => void;
    headerState: "none" | "some" | "all";
  };
  /**
   * The account as its own column. Off, because the sheet this table is read
   * from lists nine columns and the account is not one of them. With it off a
   * row still names its account under the description — but only where the
   * rows disagree about it, so a single-account register is not told its own
   * name on every line.
   */
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
  /**
   * Which entry's documents are open, and which half of them.
   *
   * `DocumentsDialog` has taken a `kinds` filter since the owner asked that
   * clicking one field show that field's document — but no caller passed one,
   * so both numbers opened the same list of everything. The bill and the
   * bank's record of the payment are different papers and the two columns ask
   * for different ones.
   */
  const [documentsFor, setDocumentsFor] = useState<{
    row: TransactionDto;
    kinds: readonly string[];
    label: string;
  } | null>(null);

  if (rows.length === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </Card>
    );
  }

  /*
    Whether naming the account on a row tells anybody anything. A register is
    one account and says which in its heading; All Transactions is every
    account, until somebody filters it down to one. Judged on the rows in
    hand, so a page that turns out to be one account does not repeat its name
    down the whole page.
  */

  /*
    The floor the columns actually need, rather than a number typed once.

    min-w-[880px] was written when this table had nine columns and it never
    moved again — it does not track the flags at all, and 880 is now less than
    the widths the headings themselves declare, so the browser was free to
    crush Description and the amounts to honour a figure that had stopped being
    true. This is summed from the same `w-*` each heading carries, with
    cell-prose's 14rem floor standing in for Description, and it follows the
    flags: the register no longer scrolls sideways to reserve room for four
    columns it never renders.
  */
  const minWidth =
    1184 +
    (showAccount ? 128 : 0) +
    (showType ? 96 : 0) +
    (showPaymentMethod ? 128 : 0) +
    (showBalance ? 128 : 0);

  return (
    <Card className="overflow-hidden">
      <TableScroll>
        <table className="table-data text-sm" style={{ minWidth }}>
          <thead>
            <tr>
              {bulk ? (
                <TickHead state={bulk.headerState} onChange={bulk.allOnPage} />
              ) : null}
              <SerialHead />
              <Th width="w-24">Date</Th>
              {/*
                What happened comes before what it was filed under. A category
                is somebody's later decision about the row; the description is
                the row. Reading down a column of categories tells you less
                than reading down the descriptions, so the descriptions take
                the position the eye lands on after the date.
              */}
              <Th>Description</Th>
              <Th width="w-40">Category</Th>
              <Th align="right" width="w-28">
                Amount (BDT)
              </Th>
              <Th align="right" width="w-28">
                Amount (USD)
              </Th>
              {/* "Rate" on its own did not say a rate between what and what. */}
              <Th align="right" width="w-20">
                USD rate
              </Th>
              {showAccount ? <Th width="w-32">Account</Th> : null}
              {/*
                Type sat third, between the date and the category, where it
                pushed the description away from the date for a fact the sign
                and the colour of the amount already carry. It belongs with the
                banking detail, after the money it describes.
              */}
              {showType ? <Th width="w-24">Type</Th> : null}
              {showPaymentMethod ? <Th width="w-32">Paid by</Th> : null}
              {/*
                Two columns, not one stack. These are the two numbers a row is
                searched for, they come from different places — ours and the
                bank's — and stacking them under a single "Reference No."
                meant neither could be scanned down or read against a heading
                that named it.
              */}
              <Th width="w-32">Invoice number</Th>
              <Th width="w-32">Transaction number</Th>
              {showBalance ? (
                <Th align="right" width="w-32">
                  Balance
                </Th>
              ) : null}
              <RowActionsHead deletable={Boolean(onDelete)} />
            </tr>
          </thead>
          <tbody>
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
                  className={cn("row-finance", voided && "opacity-55")}
                >
                  {/*
                    A position in the list, not a stored number. The sheets
                    this replaces number their rows 1..n, and that is all this
                    is — it renumbers when the filter changes, which is correct,
                    because it was never an identifier. `refNo` is.

                    Counted across the list rather than within a page: `page`
                    is 1 unless the screen sliced the rows itself, so this is
                    `index + 1` for everybody who hands over the whole list.
                  */}
                  {bulk ? (
                    <TickCell
                      checked={bulk.isTicked(row.id)}
                      onChange={() => bulk.toggle(row.id)}
                      label={row.refNo ?? row.description}
                    />
                  ) : null}
                  <SerialCell n={serial(page, index)} />
                  <td className="num">{formatDate(row.txnDate)}</td>
                  <td className="cell-prose">
                    <span
                      className={cn("font-medium", voided && "line-through")}
                    >
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
                      {/*
                        No "USD 39.00 @ 122.043217" badge here any more.

                        It printed the same two figures the Amount (USD) and
                        USD rate columns print, on the same row, three cells to
                        the right — and it printed them in a green chip, which
                        made the loudest thing in the description a repeat. The
                        one fact it carried that the columns do not is whether
                        the dollars were really sent or only converted, and the
                        USD column already says that: a converted figure is
                        marked "~", a recorded one is not.
                      */}
                      {voided ? (
                        <Badge tone="negative">
                          voided{row.voidReason ? `: ${row.voidReason}` : ""}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td>
                    {row.categoryName ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: row.categoryColor ?? undefined }}
                        />
                        {row.categoryName}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    )}
                  </td>
                  {/*
                    Three cells where there was one, and the third is what
                    makes the second readable.

                    `showCounterpart` is off because the dollars now have a
                    column of their own — leaving it on would print them twice,
                    once under the taka and once beside it.
                  */}
                  <td className="col-amount">
                    <Amount
                      value={row.signedAmount}
                      showSign
                      currency={row.currency}
                      showCounterpart={false}
                      tone={row.direction === "in" ? "in" : "out"}
                      className={cn(
                        "block font-semibold",
                        voided && "line-through",
                      )}
                    />
                  </td>
                  <td className="col-amount">
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
                        className="num text-xs text-muted-foreground"
                        title="No rate is recorded for this entry, so there is nothing to convert at. A figure here would be invented rather than approximate."
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="num text-right text-xs text-muted-foreground">
                    {rate ?? "N/A"}
                  </td>
                  {showAccount ? (
                    <td className="text-muted-foreground">
                      {/*
                        Opens the account itself — its bank, its number, what
                        is in it now. The same link the Cash In and Other
                        Expenses sheets put on their bank column, to the same
                        page; the id is on the row, so this is not a guess.
                      */}
                      {row.accountName ? (
                        <Link
                          href={`/accounts/${row.accountId}`}
                          className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
                        >
                          {row.accountName}
                        </Link>
                      ) : (
                        "N/A"
                      )}
                    </td>
                  ) : null}
                  {showType ? (
                    <td>
                      <Badge
                        tone={row.direction === "in" ? "positive" : "negative"}
                      >
                        {row.direction === "in" ? "Cash In" : "Cash Out"}
                      </Badge>
                    </td>
                  ) : null}
                  {showPaymentMethod ? (
                    <td className="text-xs text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                    </td>
                  ) : null}
                  {/*
                    The company's own number, and the bill behind it.

                    It was plain text, on the reasoning that documents hang off
                    the entry rather than off the invoice and two buttons a
                    cell apart doing the same job teaches people to press the
                    wrong one. That reasoning holds only while both buttons do
                    the same job — they no longer do. This one opens the
                    invoice; its neighbour opens the bank's record.
                  */}
                  <td className="num text-xs">
                    {row.invoiceNo ? (
                      <button
                        type="button"
                        onClick={() =>
                          setDocumentsFor({
                            row,
                            kinds: ["invoice"],
                            label: "invoice",
                          })
                        }
                        title="Show the invoice"
                        className="num cursor-pointer text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                      >
                        {row.invoiceNo}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </td>
                  {/*
                    The transaction number, and the click that opens what is
                    attached to the entry.

                    It leads with the app's own ref, which every row has, and
                    carries the bank's reference — the string a query to the
                    bank quotes — underneath. The app's ref is what takes the
                    click, for the same reason as before the split: a cell that
                    is sometimes empty cannot be the thing you press, and the
                    sheets this replaces left the bank's column blank on most
                    rows.
                  */}
                  <td>
                    <button
                      type="button"
                      onClick={() =>
                        setDocumentsFor({
                          row,
                          kinds: ["bank_statement", "receipt", "other"],
                          label: "payment",
                        })
                      }
                      title="Show the bank's record of this payment"
                      className="group cursor-pointer text-left"
                    >
                      {/*
                        The count, and a warning when it is zero.

                        The Cash In and expense screens insist on documents, but
                        a file needs a row to attach to, so an entry is saved a
                        moment before its documents are — and anybody who closes
                        the drawer in that moment leaves a recorded entry with
                        nothing attached. Without this the gap is invisible and
                        the form's insistence is theatre.
                      */}
                      <span
                        className={cn(
                          /*
                            Underlined either way — it opens the documents
                            drawer either way — but the colour keeps saying
                            what it always said: link-blue when paperwork is
                            attached, amber when the entry has nothing behind
                            it. Making both blue would have bought consistency
                            with the cost of the one warning this column
                            carries.
                          */
                          "num flex items-center gap-1 text-xs font-medium underline decoration-current/40 underline-offset-2 group-hover:decoration-current",
                          row.documentCount > 0 ? "text-link" : "text-warning",
                        )}
                        title={
                          row.documentCount > 0
                            ? `${row.documentCount} document${row.documentCount === 1 ? "" : "s"} attached`
                            : "Nothing is attached to this entry"
                        }
                      >
                        {row.documentCount > 0 ? (
                          <Paperclip className="size-3" />
                        ) : (
                          <TriangleAlert className="size-3" />
                        )}
                        {row.refNo}
                        {row.documentCount > 1 ? (
                          <span className="text-muted-foreground">
                            ×{row.documentCount}
                          </span>
                        ) : null}
                      </span>
                      {row.reference ? (
                        <span className="num block text-xs text-muted-foreground">
                          {row.reference}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  {showBalance ? (
                    <td className="col-amount">
                      {row.runningBalance ? (
                        <Amount value={row.runningBalance} tone="neutral" />
                      ) : null}
                    </td>
                  ) : null}
                  {/*
                    The pair every table in this app ends with, in the place
                    every table puts it. The verb is "void" because this is the
                    ledger: the row stays, struck through, out of every total
                    and in the audit log.

                    Both buttons render whatever the row is. A voided entry, or
                    a reader without the right to touch one, gets them greyed
                    rather than removed — this cell used to empty itself, and an
                    empty cell in a column of controls reads as a rendering
                    fault rather than as "you cannot do this". Nothing is
                    granted by showing them: with no handler passed the button
                    is disabled, so the screen still decides.
                  */}
                  <RowActions
                    onEdit={
                      canWrite && onEdit && !voided
                        ? () => onEdit(row)
                        : undefined
                    }
                    second="void"
                    onSecond={
                      canVoid && onVoid && !voided
                        ? () => onVoid(row)
                        : undefined
                    }
                    onDelete={
                      canWrite && onDelete ? () => onDelete(row) : undefined
                    }
                    extra={
                      row.receiptUrl ? (
                        <a
                          href={row.receiptUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="Open the receipt"
                          className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-primary"
                        >
                          <Link2 className="size-3.5" />
                        </a>
                      ) : null
                    }
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.row.id}
          refNo={documentsFor.row.refNo}
          kinds={documentsFor.kinds}
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
