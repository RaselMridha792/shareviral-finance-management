"use client";

import {
  fromMinorUnits,
  PAYMENT_METHOD_LABELS,
  toMinorUnits,
} from "@finance/shared";
import { LoaderCircle, Plus, ShoppingBag, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { ReferenceCell } from "@/components/ledger/reference-kind";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SummaryBar } from "@/components/ui/patterns";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { useTransactionDelete } from "@/components/ledger/use-transaction-delete";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { PAGE_SIZE, pageCount, serial } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { MonthPicker, type Range } from "./month-picker";

/**
 * As many rows as the API hands over in one request. Not a page size.
 *
 * The fetch is deliberately not paged: `spent` below — the headline "Spent in
 * August" — is added up from these rows, because no server figure answers
 * "money out with tooling excluded" (the reason is written out there). Fetch
 * twenty and that headline silently becomes the spend of twenty rows. So the
 * fetch stays whole and the table pages through it at the app's `PAGE_SIZE`.
 *
 * Two hundred is where the API stops, and it used to be where this screen
 * stopped too: a month with more than that showed a line saying so and left
 * the rest unreachable from here. The ceiling is per request, so the answer is
 * more requests — `everyRow` below asks for the pages the first reply says
 * exist.
 */
const REQUEST_MAX = 200;

/**
 * Every entry this screen owns for a month, however many requests that takes.
 *
 * The first reply carries the count, so the remaining pages are known and can
 * be asked for together rather than one after another.
 */
async function everyRow({ from, to }: { from: string; to: string }) {
  const query = { from, to, direction: "out" as const, excludeToolSpend: true };

  const first = await ledgerApi.list({
    ...query,
    page: 1,
    pageSize: REQUEST_MAX,
  });
  const pages = Math.ceil(first.total / REQUEST_MAX);
  if (pages <= 1) return first;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      ledgerApi.list({ ...query, page: i + 2, pageSize: REQUEST_MAX }),
    ),
  );
  return {
    ...first,
    items: [...first.items, ...rest.flatMap((reply) => reply.items)],
  };
}

/**
 * Everything the company spent in a month except what renews.
 *
 * The exclusion is the server's, through `excludeToolSpend`, which negates the
 * very predicate the AI tools screen counts *with*. It used to be done here by
 * dropping rows that carried a recurring vendor — a near-miss, because the
 * tools screen also counts anything paid from a non-taka account whether or not
 * a vendor was named. A ৳39,975 card payment fell into both screens, and their
 * two totals came to ৳2,72,750 against a month that spent ৳2,32,775.
 */
export function OtherExpensesScreen({
  initialRange,
  accounts,
  categories,
}: {
  initialRange: Range;
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canWrite = useCan("transactions.write");
  const canVoid = useCan("transactions.void");

  const [range, setRange] = useState(initialRange);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [recurringRows, setRecurringRows] = useState(0);
  /** How many rows this screen has, tooling already excluded. */
  const [screenTotal, setScreenTotal] = useState(0);
  /**
   * Which twenty of the fetched rows the table is showing.
   *
   * The slicing happens here rather than in the request, and that is the whole
   * argument of `FETCH_CAP`: the month's total is summed from `rows`, so
   * `rows` has to be the month. Paging the display costs one `slice` and keeps
   * the owner's rule — twenty to a page, newest first — on the one screen
   * whose headline figure a paged fetch would quietly falsify.
   */
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);
  /** Which entry's attachments are open. Set by clicking a reference number. */
  /**
   * Which entry's documents are open, and which half of them.
   *
   * The bill and the bank's record of the payment are different papers, and
   * the two columns ask for different ones — so the dialog is told which.
   */
  const [documentsFor, setDocumentsFor] = useState<{
    row: TransactionDto;
    kinds: readonly string[];
  } | null>(null);

  /**
   * A new month is a new and usually shorter list, and page 4 of it may not
   * exist. Landing there shows an empty table on a month that has expenses in
   * it, which reads as a broken screen rather than as a page number left over
   * from the month before.
   */
  const changeRange = useCallback((next: Range) => {
    setRange(next);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Two calls: the month as a whole, and the month without tooling. The
      // difference is what the tools screen owns, and asking the server for
      // both means the two screens cannot disagree about where the line is.
      const [all, list] = await Promise.all([
        ledgerApi.list({
          from: range.from,
          to: range.to,
          direction: "out",
          page: 1,
          pageSize: 1,
        }),
        everyRow({ from: range.from, to: range.to }),
      ]);

      setRows(list.items);
      setRecurringRows(all.total - list.items.length);
      setScreenTotal(list.total);
    } catch (caught) {
      // Without this the screen sits on "Loading…" for ever and never says why.
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load this month.",
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  const del = useTransactionDelete(() => void load());

  useEffect(() => {
    // Fetching from the API when the period changes — the rule's own
    // "subscribe to an external system" case. The setState calls happen in the
    // await continuation, not during render, so there is no cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /*
   * The month's spend, summed from every fetched row — never from the page.
   *
   * `rows` is the whole month here and not a page of it, which is the only
   * reason this reduce is allowed to stand. Neither server total can answer
   * this screen's question: `/expenses/summary` counts the subscriptions it
   * exists to leave out, and `/transactions/summary` does accept
   * `excludeToolSpend` but sums `from(transactions)` with no join to
   * `accounts` or `vendors` — the two tables `isToolSpend()` reads — so the
   * flag makes that query fail rather than answer. Until it joins them the way
   * the list's own count already does, the honest month total is this one,
   * over an unpaged fetch.
   *
   * Minor units in bigint, never floats — 0.1 + 0.2 has no place in a ledger.
   * `BigInt(0)` rather than `0n`: the build targets ES2017, which has no
   * literal for it.
   */
  const spent = fromMinorUnits(
    rows
      // A voided row stays on screen struck through, and out of the total.
      // It was in this one — so "Spent in August" counted the very entries
      // this screen draws a line through, and the figure disagreed with its
      // own rows for anybody who added them up.
      .filter((row) => !row.voidedAt)
      .reduce((sum, row) => sum + toMinorUnits(row.amount), BigInt(0)),
  );

  /*
   * Pages of the whole month, because the whole month is what arrived.
   *
   * This used to page `rows.length` and warn, above the table, that it was
   * "showing the most recent 200 of 340" — a sentence that existed only
   * because the fetch stopped early. It does not stop early any more, so
   * `rows.length` and `screenTotal` are the same number and there is nothing
   * left to apologise for.
   */
  const totalPages = pageCount(rows.length);
  /* Clamped rather than reset: voiding the last row of the last page shortens
     the list under the reader, and a page number past the end would leave them
     on an empty table until they touched the control. */
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      <PageHeader
        title="Other expenses"
        description="Everything the company spent that is not an AI tool or a subscription."
        actions={
          <>
            <MonthPicker range={range} onChange={changeRange} />
            {/* No Excel button: the export takes the same filter the list
                does, which cannot say "except these vendor types", so the
                sheet would not be what is on screen. */}
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                Add expense
              </Button>
            ) : null}
          </>
        }
      />

      <SummaryBar
        label={`Spent in ${range.label}`}
        icon="shopping_basket"
        iconTone="text-warning"
        description={
          recurringRows > 0 ? (
            <>
              <span className="num">{recurringRows}</span> recurring payment
              {recurringRows === 1 ? "" : "s"} left out — they are counted on AI
              tools and subscriptions
            </>
          ) : (
            "Subscriptions and AI tools are counted on their own screen"
          )
        }
        value={<Amount value={spent} tone="neutral" />}
      />

      <Card>
        <CardHeader
          title={`Every other expense in ${range.label}`}
          // The envelope's count of the whole month, not the length of the
          // page below it.
          description={`${screenTotal} entr${screenTotal === 1 ? "y" : "ies"}`}
        />
        <CardBody className="p-0">
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
                <ShoppingBag className="size-6" />
              </span>
              <div>
                <p className="text-lg font-semibold">
                  Nothing but subscriptions in {range.label}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Record an expense, or step back a month to see an earlier one.
                </p>
              </div>
            </div>
          ) : (
            /*
              The owner's sheet, column for column.

              This was the shared ledger table with two flags set, and no flag
              could get it there: that table leads with a Reference column
              carrying three numbers at once and puts the amounts last, while
              "Other Expenses (Excluding AI & Tools)" is nine columns in a
              fixed order that the people reading this screen already read on
              paper. So the table is written out here rather than bent into
              shape from four screens away — All Transactions keeps the shared
              one, untouched.

              Ten columns, not nine. Account is the one addition, next to
              Payment Method because how it was paid and what it was paid from
              are one thought, and because the owner asked for the account name
              to open the account. Eleven with the actions column, which is not
              a column of the sheet: it is where every table in the app keeps
              its edit and void.
            */
            <TableScroll>
              <table className="table-data min-w-[1408px] text-sm">
                <thead>
                  <tr className="text-left">
                    {/* Row order, like the sheet's own SL — not a stored
                        number. Every entry already carries `refNo`, and a
                        second identity that renumbers itself when the month
                        changes is one people would quote at each other and get
                        wrong. */}
                    <SerialHead />
                    <Th width="w-24">Date</Th>
                    <Th>Description</Th>
                    <Th width="w-40">Category</Th>
                    <Th width="w-32" align="right">
                      Amount (BDT)
                    </Th>
                    <Th width="w-28" align="right">
                      Amount (USD)
                    </Th>
                    <Th width="w-24" align="right">
                      USD Rate
                    </Th>
                    <Th width="w-36">Account</Th>
                    <Th width="w-32">Payment Method</Th>
                    {/* Two numbers, because the paperwork has two: ours on the
                        invoice, theirs on the bank's record of the movement.
                        One column held whichever was typed, and the other fact
                        had nowhere to be. */}
                    <Th width="w-32">Invoice No.</Th>
                    <Th width="w-32">Transaction ID</Th>
                    {/* Eleventh column. It is not on the owner's sheet, but
                        the pair sits in the same place on every table in the
                        app, and riding inside Description made the widest
                        prose cell the narrowest one. */}
                    <RowActionsHead deletable />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, index) => {
                    const voided = Boolean(row.voidedAt);
                    const rate = rateOf(row);
                    const usd = dollarsOf(row);
                    // Dollars that were actually sent, against dollars worked
                    // out from taka. Only the first is a recorded fact, and
                    // the column marks the second with a tilde.
                    const recordedInUsd =
                      row.originalCurrency === "USD" &&
                      Boolean(row.originalAmount);

                    return (
                      <tr
                        key={row.id}
                        className={cn("row-finance", voided && "opacity-55")}
                      >
                        {/* Counted across the pages rather than within
                            one: `index + 1` restarts at 1 on page two, and two
                            rows of one table answering to the same number is
                            the number somebody reads out to somebody else. */}
                        <SerialCell n={serial(current, index)} />
                        <td className="num whitespace-nowrap">{row.txnDate}</td>
                        <td className="cell-prose">
                          <span
                            className={cn(
                              "font-medium",
                              voided && "line-through",
                            )}
                          >
                            {row.description}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {/* Who it was with. The account, the payment
                                method and the dollars have columns of their
                                own now, so this is all that is left under a
                                description — any of those three here would
                                print the same fact on the row twice. */}
                            {row.vendorName ?? row.counterparty ?? null}
                            {/* Own money moved between own accounts. It lands
                                as a money-out row and is counted in the total
                                above, so a row that is not really an expense
                                has to say so. */}
                            {row.transferGroupId ? (
                              <Badge>transfer</Badge>
                            ) : null}
                            {Number(row.withheldTaxAmount) > 0 ? (
                              <Badge tone="warning">
                                tax withheld{" "}
                                <span className="num">
                                  {row.withheldTaxAmount}
                                </span>
                              </Badge>
                            ) : null}
                            {voided ? (
                              <Badge tone="negative">
                                voided
                                {row.voidReason ? `: ${row.voidReason}` : ""}
                              </Badge>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          {row.categoryName ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{
                                  background: row.categoryColor ?? undefined,
                                }}
                              />
                              {row.categoryName}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        {/* Every row on this screen is money leaving, so the
                            figure is red and signed on all of them. No dollar
                            line underneath it: the next column is the
                            dollars. */}
                        <td className="text-right">
                          <Amount
                            value={row.signedAmount}
                            showSign
                            currency={row.currency}
                            showCounterpart={false}
                            tone="out"
                            className={cn(
                              "block font-semibold",
                              voided && "line-through",
                            )}
                          />
                        </td>
                        <td className="text-right">
                          {usd ? (
                            <Amount
                              value={usd}
                              showSign
                              currency="USD"
                              approximate={!recordedInUsd}
                              showCounterpart={false}
                              tone="out"
                              className={cn("block", voided && "line-through")}
                            />
                          ) : (
                            <span
                              className="col-amount block text-xs text-muted-foreground"
                              title="No rate is recorded for this entry, so there is nothing to convert at. A figure here would be invented rather than approximate."
                            >
                              —
                            </span>
                          )}
                        </td>
                        <td className="col-amount text-xs text-muted-foreground">
                          {rate ? trimRate(rate) : "—"}
                        </td>
                        <td>
                          {/* Opens the account itself — its bank, its number,
                              what is in it now — rather than filtering this
                              list. The same link the Cash In sheet's bank
                              column carries, to the same page. */}
                          {row.accountName ? (
                            <Link
                              href={`/accounts/${row.accountId}`}
                              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
                            >
                              {row.accountName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                        </td>
                        <td>
                          {/* The number opens what it refers to. The amber
                              mark is an entry that has a reference and nothing
                              attached to it — the row somebody has to chase,
                              and invisible unless the table says so. */}
                          {row.invoiceNo ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDocumentsFor({ row, kinds: ["invoice"] })
                              }
                              title="Show the invoice"
                              className="num inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
                            >
                              {row.documentCount === 0 ? (
                                <TriangleAlert className="size-3 shrink-0 text-warning" />
                              ) : null}
                              {row.invoiceNo}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        {/* Number, eye, or dash — ledger/reference-kind.tsx */}
                        <ReferenceCell
                          value={row.reference}
                          documentCount={row.documentCount}
                          onOpen={() =>
                            setDocumentsFor({
                              row,
                              kinds: ["bank_statement", "receipt", "other"],
                            })
                          }
                        />
                        {/* Both buttons always render. A voided row, or a
                            reader without the permission, gets the pair
                            disabled rather than an empty cell — a blank where
                            every other row has controls reads as a rendering
                            fault, not as "you cannot do this". */}
                        <RowActions
                          second="void"
                          onEdit={
                            canWrite && !voided
                              ? () => setEditing(row)
                              : undefined
                          }
                          onSecond={
                            canVoid && !voided
                              ? () => setVoiding(row)
                              : undefined
                          }
                          onDelete={canWrite ? () => del.ask(row) : undefined}
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </CardBody>
      </Card>

      {/* A sibling of the card, never inside the loading-or-empty branch above
        — the page somebody most needs this control on is the empty one, and a
        pager written in the table's branch is the one that is not there. It
        renders nothing at all while a month fits on one page. */}
      <Pagination
        page={current}
        totalPages={totalPages}
        total={rows.length}
        noun="entry"
        nounPlural="entries"
        onPage={setPage}
      />

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.row.id}
          // The reference that was clicked, falling back to the app's own
          // entry number — `refNo` is what this row is called everywhere else,
          // and the sheet's columns no longer show it.
          refNo={documentsFor.row.invoiceNo ?? documentsFor.row.refNo}
          kinds={documentsFor.kinds}
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}

      <TransactionForm
        open={creating}
        defaultDirection="out"
        accounts={accounts}
        categories={categories}
        lockDirection
        onClose={() => setCreating(false)}
        onSaved={load}
      />
      <TransactionForm
        key={editing?.id}
        open={Boolean(editing)}
        transaction={editing ?? undefined}
        accounts={accounts}
        categories={categories}
        lockDirection
        onClose={() => setEditing(null)}
        onSaved={load}
      />
      <VoidDialog
        transaction={voiding}
        onClose={() => setVoiding(null)}
        onVoided={load}
      />
      {del.dialog}
    </>
  );
}

/**
 * The rate a single row was read at, or null when it has none.
 *
 * `fxRate` when the entry recorded dollars — the bank actually converted at it
 * — and `usdRate`, the reference rate captured on the day, when it did not.
 * The same order the shared ledger table uses, so a row reads the same on both
 * screens; and it is the rate the USD column divides by, so the two columns
 * cannot disagree about which number produced which.
 */
function rateOf(row: TransactionDto): string | null {
  const rate = row.originalCurrency === "USD" ? row.fxRate : row.usdRate;
  return rate && Number(rate) > 0 ? rate : null;
}

/**
 * How many dollars a row is, as a negative figure — everything on this screen
 * is money leaving, and a dollar column that disagreed in sign with the taka
 * beside it would read as a refund.
 *
 * The stored amount when dollars are what actually moved; the taka read at the
 * row's own rate otherwise, which the column marks with a tilde. A row with
 * neither is left blank rather than converted at some other day's rate — the
 * rule the account cards and the Cash In sheet already follow.
 *
 * Nothing is summed from this. The month's total above is taka added in minor
 * units; this is a reading.
 */
function dollarsOf(row: TransactionDto): string | null {
  if (row.originalCurrency === "USD" && row.originalAmount) {
    // Stored as a magnitude, like `amount` — the sign lives in the direction,
    // so it is put back as a string. Money here is `numeric(14,2)` read as a
    // string, never a float.
    return `-${row.originalAmount.trim().replace(/^[+-]/, "")}`;
  }

  const rate = rateOf(row);
  if (!rate) return null;

  const value = Number(row.amount) / Number(rate);
  return Number.isFinite(value) ? (-value).toFixed(2) : null;
}

/** 122.770000 reads as a database artefact; 122.77 reads as a rate. */
function trimRate(rate: string): string {
  const trimmed = rate.includes(".") ? rate.replace(/0+$/, "") : rate;
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}
