"use client";

import {
  fromMinorUnits,
  PAYMENT_METHOD_LABELS,
  toMinorUnits,
} from "@finance/shared";
import {
  Ban,
  LoaderCircle,
  Plus,
  ShoppingBag,
  SquarePen,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryBar } from "@/components/ui/patterns";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { MonthPicker, type Range } from "./month-picker";

/**
 * The API caps a page at 200. The subscription rows are dropped after the
 * fetch, so this asks for the maximum and says out loud when a month has more.
 */
const PAGE_SIZE = 200;

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
  const [fetched, setFetched] = useState(0);
  const [monthTotal, setMonthTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);
  /** Which entry's attachments are open. Set by clicking a reference number. */
  const [documentsFor, setDocumentsFor] = useState<TransactionDto | null>(null);

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
        ledgerApi.list({
          from: range.from,
          to: range.to,
          direction: "out",
          excludeToolSpend: true,
          page: 1,
          pageSize: PAGE_SIZE,
        }),
      ]);

      setRows(list.items);
      setRecurringRows(all.total - list.total);
      setFetched(list.items.length);
      setMonthTotal(all.total);
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

  useEffect(() => {
    // Fetching from the API when the period changes — the rule's own
    // "subscribe to an external system" case. The setState calls happen in the
    // await continuation, not during render, so there is no cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Summed from the rows on screen rather than from /expenses/summary: that
  // total counts the subscriptions this screen exists to leave out. Minor
  // units in bigint, never floats — 0.1 + 0.2 has no place in a ledger.
  // `BigInt(0)` rather than `0n`: the build targets ES2017, which has no
  // literal for it.
  const spent = fromMinorUnits(
    rows.reduce((sum, row) => sum + toMinorUnits(row.amount), BigInt(0)),
  );

  const truncated = fetched < monthTotal;

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
            <MonthPicker range={range} onChange={setRange} />
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
          description={
            truncated
              ? `Showing the most recent ${fetched} of ${monthTotal} money-out entries — narrow the month or use All transactions to see the rest`
              : `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
          }
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
              to open the account.
            */
            <div className="overflow-x-auto">
              <table className="table-data min-w-[1180px] text-sm">
                <thead>
                  <tr className="text-left">
                    {/* Row order, like the sheet's own SL — not a stored
                        number. Every entry already carries `refNo`, and a
                        second identity that renumbers itself when the month
                        changes is one people would quote at each other and get
                        wrong. */}
                    <Th className="w-12 text-right">SL</Th>
                    <Th className="w-24">Date</Th>
                    <Th className="w-40">Category</Th>
                    <Th>Description</Th>
                    <Th className="w-32 text-right">Amount (BDT)</Th>
                    <Th className="w-28 text-right">Amount (USD)</Th>
                    <Th className="w-32">Payment Method</Th>
                    <Th className="w-36">Account</Th>
                    {/* The company's own document number — the invoice the
                        money went against. The bank's number is a different
                        fact under a different name, Transaction ID, and the
                        sheet has one reference column: this is the one it
                        means. */}
                    <Th className="w-32">Reference No.</Th>
                    <Th className="w-24 text-right">USD Rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
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
                        <td className="num px-4 py-2.5 text-right text-xs text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="num px-4 py-2.5 whitespace-nowrap">
                          {row.txnDate}
                        </td>
                        <td className="px-4 py-2.5">
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
                        <td className="cell-prose px-4 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
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
                                    method and the dollars have columns of
                                    their own now, so this is all that is left
                                    under a description — any of those three
                                    here would print the same fact on the row
                                    twice. */}
                                {row.vendorName ?? row.counterparty ?? null}
                                {/* Own money moved between own accounts. It
                                    lands as a money-out row and is counted in
                                    the total above, so a row that is not
                                    really an expense has to say so. */}
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
                                    {row.voidReason
                                      ? `: ${row.voidReason}`
                                      : ""}
                                  </Badge>
                                ) : null}
                              </span>
                            </div>
                            {/* Edit and void have a column of their own on the
                                shared table. An eleventh column is not on the
                                owner's sheet, so the two controls ride in the
                                one cell with room for them — and stay visible
                                rather than appearing on hover, because a
                                tablet has no hover to appear on. */}
                            <div className="flex shrink-0 items-center gap-1">
                              {canWrite && !voided ? (
                                <button
                                  type="button"
                                  onClick={() => setEditing(row)}
                                  title="Edit"
                                  className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                                >
                                  <SquarePen className="size-3.5" />
                                </button>
                              ) : null}
                              {canVoid && !voided ? (
                                <button
                                  type="button"
                                  onClick={() => setVoiding(row)}
                                  title="Void"
                                  className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-negative"
                                >
                                  <Ban className="size-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        {/* Every row on this screen is money leaving, so the
                            figure is red and signed on all of them. No dollar
                            line underneath it: the next column is the
                            dollars. */}
                        <td className="px-4 py-2.5 text-right">
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
                        <td className="px-4 py-2.5 text-right">
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
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {PAYMENT_METHOD_LABELS[row.paymentMethod]}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* Opens the account itself — its bank, its number,
                              what is in it now — rather than filtering this
                              list. The same link the Cash In sheet's bank
                              column carries, to the same page. */}
                          {row.accountName ? (
                            <Link
                              href={`/accounts/${row.accountId}`}
                              className="transition hover:text-primary hover:underline"
                            >
                              {row.accountName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {/* The number opens what it refers to. The amber
                              mark is an entry that has a reference and nothing
                              attached to it — the row somebody has to chase,
                              and invisible unless the table says so. */}
                          {row.invoiceNo ? (
                            <button
                              type="button"
                              onClick={() => setDocumentsFor(row)}
                              title={
                                row.documentCount > 0
                                  ? `${row.documentCount} attached`
                                  : "Nothing attached to this entry"
                              }
                              className="num inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-surface-muted hover:text-primary"
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
                        <td className="col-amount px-4 py-2.5 text-xs text-muted-foreground">
                          {rate ? trimRate(rate) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.id}
          // The reference that was clicked, falling back to the app's own
          // entry number — `refNo` is what this row is called everywhere else,
          // and the sheet's ten columns no longer show it.
          refNo={documentsFor.invoiceNo ?? documentsFor.refNo}
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
