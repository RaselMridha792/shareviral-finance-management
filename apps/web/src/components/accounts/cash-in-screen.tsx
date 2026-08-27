"use client";

import {
  fiscalYearOf,
  monthIndexInFiscalYear,
  monthRange,
  todayInDhaka,
} from "@finance/shared";
import { Landmark, LoaderCircle, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatCell, StatStrip } from "@/components/ui/patterns";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { useTransactionDelete } from "@/components/ledger/use-transaction-delete";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import { PAGE_SIZE, pageCount, serial } from "@/lib/pagination";
import { reportsApi } from "@/lib/reports";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { ReferenceCell } from "@/components/ledger/reference-kind";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { MonthPicker } from "@/components/expenses/month-picker";
import { CashInForm } from "./cash-in-form";

/**
 * Money arriving from abroad, month by month.
 *
 * The strip above the table says what the month received, in taka and in
 * dollars. The month's rate is behind that second figure and behind the USD
 * column, but it is not shown as a figure of its own any more — it had a cell
 * in the strip and the owner took it off this screen.
 *
 * That rate is *asked for*, not worked out here. It used to be recomputed on
 * this screen from the rows it had already loaded, a second copy of a rule that
 * decides every dollar figure in the app and that the API answers directly:
 * `/reports/overview` returns `usdRate` for a period, resolved by
 * `FxService.fundingRateFor` with the Settings rate behind it. One rule, one
 * implementation — this screen can no longer drift away from the reports.
 */
export function CashInScreen({ accounts }: { accounts: AccountDto[] }) {
  const canWrite = useCan("transactions.write");
  /**
   * Undoing an entry is its own permission rather than a shade of writing one:
   * a role can be trusted to fix a typo on a receipt and not to take that
   * receipt out of the month's totals.
   */
  const canVoid = useCan("transactions.void");
  /**
   * The overview needs `dashboard.money`; this screen needs `accounts.read`.
   * A role can hold the second without the first, so the month's rate is asked
   * for only when it can be. Without it the dollar figure under the total is
   * simply absent and the taka the page is about is untouched — which is why
   * the request is allowed to fail quietly.
   */
  const canSeeRate = useCan("dashboard.money");
  const { fiscalYearMode } = useSettings();

  const [month, setMonth] = useState(() => todayInDhaka().slice(0, 7));
  /** Which page of the month is on screen. 1-based, the way the pager counts. */
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  /**
   * The receipt a correction or an undo is open on.
   *
   * Both are the ledger's own flows — the drawer every other screen edits an
   * entry in, and the dialog that insists on a reason before voiding — so a
   * wrong figure is dealt with in the month somebody noticed it, rather than
   * by going to find the row again on the Transactions page.
   */
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);
  /**
   * Which entry, and which of its documents.
   *
   * Both, because the two numbers on a row point at different paper — the
   * invoice this transfer settles, and the bank's own record of it — and a
   * click on one of them should answer with that one.
   */
  const [documentsFor, setDocumentsFor] = useState<{
    row: TransactionDto;
    kind: "invoice" | "bank_statement";
  } | null>(null);

  /** The month's rate, straight from the API. Null when there is none. */
  const [rate, setRate] = useState<string | null>(null);
  const [rateStatus, setRateStatus] = useState<"hidden" | "loading" | "ready">(
    canSeeRate ? "loading" : "hidden",
  );

  const requestRef = useRef(0);
  const rateRequestRef = useRef(0);
  const range = monthRange(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
  );

  const from = range.start;
  const to = range.end;

  // Which period of which financial year the chosen month is, in the terms
  // /reports/overview takes. July is period 1 of a Bangladeshi financial year
  // and January is period 1 of a calendar one, which is why the mode comes
  // from settings rather than from an assumption.
  const fiscalYear = fiscalYearOf(from, fiscalYearMode);
  const periodIndex = monthIndexInFiscalYear(
    Number(month.slice(5, 7)),
    fiscalYearMode,
  );

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      // The month, whole — deliberately not a page of it. Three figures on
      // this screen are read across every receipt in the month (see the slice
      // under the totals), and the API has no aggregate that answers any of
      // them, so the rows have to be here to be counted. 200 is the list
      // endpoint's own ceiling on pageSize.
      const result = await ledgerApi.list({
        from,
        to,
        direction: "in",
        pageSize: 200,
        sort: "txnDate",
        order: "desc",
      });
      // A slower earlier request must not overwrite a faster later one.
      if (request !== requestRef.current) return;
      setRows(result.items);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load this month's receipts.",
      );
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [from, to]);

  /**
   * The month's rate, as the API resolves it.
   *
   * A failure here is not a failure of this screen. The most likely one is a
   * 403 from a role that may see the receipts and not the money figures, and
   * the honest response to that is to drop the rate strip — never to take a
   * working page down over a caption.
   */
  const loadRate = useCallback(async () => {
    if (!canSeeRate) return;
    const request = ++rateRequestRef.current;
    setRateStatus("loading");
    try {
      const report = await reportsApi.overview({
        granularity: "month",
        fiscalYear,
        index: periodIndex,
      });
      if (request !== rateRequestRef.current) return;
      setRate(report.usdRate);
      setRateStatus("ready");
    } catch {
      if (request !== rateRequestRef.current) return;
      setRate(null);
      setRateStatus("hidden");
    }
  }, [canSeeRate, fiscalYear, periodIndex]);

  /**
   * The table and the strip above it, together.
   *
   * Any receipt that changes can be the one the month's rate is read off — a
   * corrected rate, or a voided transfer that happened to be the first funded
   * row — so reloading the rows without re-asking for the rate would leave the
   * caption stating a figure the table underneath no longer supports.
   */
  const refresh = useCallback(async () => {
    await Promise.all([load(), loadRate()]);
  }, [load, loadRate]);

  const del = useTransactionDelete(() => refresh());

  useEffect(() => {
    // Fetching from the API when the month changes — the rule's own "subscribe
    // to an external system" case. The setState calls happen in the await
    // continuation, not during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadRate();
  }, [load, loadRate]);

  /**
   * Moving our own money between our own accounts is not money received, but
   * it does land as a money-in row in the account it arrives in. Counting it
   * here would inflate what the company was sent.
   */
  const received = rows.filter((row) => !row.transferGroupId);

  const totalBdt = received
    .reduce((sum, row) => sum + Number(row.amount), 0)
    .toFixed(2);

  // The same rule as the column below, through the same function. Dividing the
  // total by one rate would quietly restate a transfer that arrived at a
  // different one — and two implementations of "how many dollars was that"
  // would disagree on exactly the rows where the bank took a charge, which is
  // most of them.
  const totalUsd = rate
    ? received
        .reduce((sum, row) => sum + Number(dollarsOf(row, rate) ?? 0), 0)
        .toFixed(2)
    : null;

  /**
   * The page on screen, cut from the month rather than asked for as one.
   *
   * Every other table here fetches its page. This one cannot, and the reason is
   * the strip above it: both figures in "Received in {month}" are sums over the
   * month's receipts *minus internal transfers*, and no endpoint answers that.
   * `/transactions/summary` sums by direction only — a transfer between our own
   * accounts is a money-in row to it, which is the one thing this screen's total
   * refuses to count — and no dollar total exists server-side at all, since the
   * USD column is per-row (`dollarsOf`), not a division of the taka figure.
   * Ask the API for twenty rows and "Received in July" silently becomes
   * "received on this page", which is a wrong number, not a small one.
   *
   * So the month comes down whole and is paged here. What the pager counts is
   * `received` — already free of transfers — so the sentence under the table
   * counts exactly the rows the table shows.
   */
  const totalPages = pageCount(received.length);
  /**
   * Voiding the last entry on the last page shortens the set underneath the
   * reader. Clamping here beats an effect that fixes the state up afterwards,
   * and it means nothing has to be reset when a refresh comes back smaller.
   */
  const currentPage = Math.min(page, totalPages);
  const visible = received.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <>
      {/*
        The month lives with the actions, which is where Expenses and Other
        expenses already keep theirs, and it is a list rather than a field: a
        native month input asks for "mm/yyyy" through a calendar popover, while
        a select says in one glance how far back the books go. `MonthPicker`
        builds that list from the months that have actually happened, so there
        is nothing greyed in it and nothing to maintain.

        Still months and not the shared date range. This screen is organised by
        month all the way down — the totals are a month's, and the rate is the
        month's rate, asked for by fiscal year and period index. A free from/to
        would name no period to ask about, and would quietly turn the two
        figures above the table into something else.
      */}
      <PageHeader
        title="Cash in"
        icon="savings"
        actions={
          <>
            <MonthPicker
              range={{ from: range.start, to: range.end, label: range.label }}
              onChange={(next) => {
                setMonth(next.from.slice(0, 7));
                // A different month is a different, differently sized set.
                // Staying on page three of it opens on an empty table.
                setPage(1);
              }}
            />
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setRecording(true)}
              >
                <Plus className="size-4" />
                Add cash
              </Button>
            ) : null}
          </>
        }
      />

      {/*
        One figure, in a strip rather than a card.

        There was a second cell here — "Rate this month", the rate the month's
        first funding landed at and the entry that set it. The owner took it
        off this screen: it is a reports detail on a page whose subject is the
        receipts, and the rate is still on every row of the table below in the
        USD rate column, which is where a reader checking a particular receipt
        looks anyway.

        The rate is still *fetched*. It is what turns the taka total into the
        dollar figure under it and what fills the USD column for a row that
        carries no rate of its own — it is simply no longer a cell.
      */}
      <StatStrip min={280}>
        <StatCell
          label={`Received in ${range.label}`}
          icon="south_west"
          iconTone="text-positive"
          value={<Amount value={totalBdt} tone="in" showCounterpart={false} />}
          secondary={
            totalUsd ? (
              <Amount
                value={totalUsd}
                currency="USD"
                tone="neutral"
                approximate
                showCounterpart={false}
              />
            ) : rateStatus === "ready" ? (
              "No rate on record for this month"
            ) : null
          }
        />
      </StatStrip>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <Card className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading…
        </Card>
      ) : received.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Landmark className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">
              Nothing received in {range.label}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Record a transfer as it arrives — the rate it lands at is the one
              the whole month is read in.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            {/* 1320 was the eleven columns of data. The actions column adds
                its own w-24, so the floor moves with it instead of letting the
                browser crush Description to keep an old number true. */}
            <table className="table-data min-w-[1416px] text-sm">
              <thead>
                <tr className="text-left">
                  {/* Row order, like the sheet's own SL — not a stored number.
                      Every entry already carries `ref_no`, and a second
                      identity that renumbers itself when a row is voided would
                      be one people quote at each other and get wrong. */}
                  <SerialHead />
                  <Th width="w-28">Date</Th>
                  <Th>Description</Th>
                  <Th align="right">Amount (BDT)</Th>
                  <Th align="right">Amount (USD)</Th>
                  <Th align="right">USD rate</Th>
                  {/* Ours — the account the money landed in. The column after
                      it is the other end of the wire, and both of them are a
                      bank account: only the two headings say which side each
                      one is. */}
                  <Th>Received Bank Name</Th>
                  <Th>Sender</Th>
                  <Th>Invoice No.</Th>
                  <Th>Transaction ID</Th>
                  <Th>Note</Th>
                  <RowActionsHead deletable />
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => {
                  // What was actually sent, when the entry recorded it. Only
                  // divided out when it did not: a derived figure is the app's
                  // arithmetic, and the stored one is the remittance advice.
                  const sentUsd = dollarsOf(row, rate);
                  // Voided entries are never asked for here, so this is the
                  // rule rather than a case on screen: a voided row cannot be
                  // edited and cannot be voided twice, and the pair goes grey
                  // rather than missing if one ever reaches this table.
                  const voided = Boolean(row.voidedAt);
                  return (
                    <tr key={row.id} className="row-finance">
                      <SerialCell n={serial(currentPage, index)} />
                      <td className="num">{row.txnDate}</td>
                      <td className="cell-prose">
                        <span className="font-medium">{row.description}</span>
                      </td>
                      <td className="text-right">
                        <Amount
                          value={row.amount}
                          tone="in"
                          showCounterpart={false}
                          className="block"
                        />
                      </td>
                      <td className="text-right">
                        {sentUsd ? (
                          <Amount
                            value={sentUsd}
                            currency="USD"
                            tone="in"
                            showCounterpart={false}
                            approximate={
                              row.originalCurrency !== "USD" ||
                              !row.originalAmount
                            }
                            className="block"
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="col-amount text-muted-foreground">
                        {/* The rate this row was recorded at — not the month's,
                            unless this row is the one that set it. */}
                        {rateOf(row)
                          ? `৳${trimRate(rateOf(row) as string)}`
                          : "—"}
                      </td>
                      <td>
                        {/* Opens the account itself — its bank, branch, number
                            and what it holds now — rather than this screen's
                            own list. "Which account did that land in, and what
                            is in it" is one question, and it was two pages. */}
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
                      <td>
                        {/* One name, the way the sheet has it. The advice also
                            gives the sending bank, the account number and a
                            SWIFT code; those stay on the entry rather than
                            crowd a column the sheet writes as one sender. */}
                        {row.senderAccountName ?? row.senderBankName ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <DocumentCell
                        row={row}
                        kind="invoice"
                        onOpen={setDocumentsFor}
                      >
                        {row.invoiceNo}
                      </DocumentCell>
                      {/*
                        The reference column: the number when the bank gave
                        one, an eye when all there is is the slip. See
                        ledger/reference-kind.tsx for why nothing is stored to
                        say which.
                      */}
                      <ReferenceCell
                        value={row.reference}
                        documentCount={row.documentCount}
                        onOpen={() =>
                          setDocumentsFor({ row, kind: "bank_statement" })
                        }
                      />
                      <td className="max-w-[18rem] text-muted-foreground">
                        {/* The only one of the thirteen fields that is not
                            required, and a note nobody sees is a note nobody
                            writes — so it is on the row, cut to the column
                            with the whole of it on hover. */}
                        {row.notes ? (
                          <span title={row.notes} className="block truncate">
                            {row.notes}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/*
                        Last, after every column of data, which is where every
                        table in this app now ends. The verb is "void" because
                        these are ledger rows: the entry stays on screen, out of
                        every total and in the audit log.

                        Both buttons are drawn whatever the row is and whoever
                        is reading. Someone without the right gets them greyed
                        rather than removed — an empty cell in a column of
                        controls reads as a rendering fault, not as "you cannot
                        do this" — and drawing them grants nothing, since a
                        button handed no handler is disabled.
                      */}
                      <RowActions
                        onEdit={
                          canWrite && !voided
                            ? () => setEditing(row)
                            : undefined
                        }
                        second="void"
                        onSecond={
                          canVoid && !voided ? () => setVoiding(row) : undefined
                        }
                        onDelete={canWrite ? () => del.ask(row) : undefined}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {/* Outside the block above, never inside it: the loading and empty
          states replace the entire table, and a pager written in there would
          disappear on precisely the page somebody needs it on to get back.
          It draws nothing at all while the month fits on one page. */}
      <Pagination
        page={currentPage}
        totalPages={totalPages}
        total={received.length}
        noun="entry"
        onPage={setPage}
      />

      {documentsFor ? (
        <DocumentsDialog
          transactionId={documentsFor.row.id}
          kinds={[documentsFor.kind]}
          title={documentsFor.kind === "invoice" ? "Invoice" : "Bank statement"}
          refNo={
            (documentsFor.kind === "invoice"
              ? documentsFor.row.invoiceNo
              : documentsFor.row.reference) ?? documentsFor.row.refNo
          }
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}

      {/*
        One form, recording and correcting.

        It briefly used the ledger's general drawer for corrections, on the
        reasoning that a correction is an ordinary money-in edit. It is not:
        this screen exists because a remittance asks its own questions — who
        sent it, against which invoice, at what rate — and the general drawer
        asks none of them. So the fields somebody most needs to fix were the
        exact fields they could not reach.

        The account is the one thing an edit cannot change. Moving money
        between two balances by editing a row is what a ledger must refuse;
        landing it in the wrong account is fixed by voiding and recording
        again, which leaves a trail.
      */}
      <CashInForm
        key={editing?.id ?? "new"}
        open={recording || Boolean(editing)}
        transaction={editing ?? undefined}
        accounts={accounts}
        onClose={() => {
          setRecording(false);
          setEditing(null);
        }}
        // Both: a transfer recorded into an empty month is the entry that sets
        // the rate, so the dollar figures are stale the moment the table is.
        onSaved={refresh}
      />
      <VoidDialog
        transaction={voiding}
        onClose={() => setVoiding(null)}
        onVoided={refresh}
      />
      {del.dialog}
    </>
  );
}

/**
 * A number on the sheet that opens what it refers to.
 *
 * The invoice number and the transaction id both point at paper — the invoice
 * itself and the bank's statement — and both were asked to be clickable. They
 * open the same panel because they are attached to the same entry; which one
 * was clicked is not a filter on what comes back.
 *
 * The amber mark is for an entry with a number and nothing attached to it. A
 * remittance whose advice was never uploaded is exactly the row somebody has
 * to chase, and it is invisible unless the table says so.
 */
function DocumentCell({
  row,
  kind,
  children,
  onOpen,
}: {
  row: TransactionDto;
  /** Which paper this number points at — the invoice, or the bank's record. */
  kind: "invoice" | "bank_statement";
  children: string | null;
  onOpen: (of: {
    row: TransactionDto;
    kind: "invoice" | "bank_statement";
  }) => void;
}) {
  if (!children) {
    return <td className="text-muted-foreground">—</td>;
  }

  return (
    <td>
      <button
        type="button"
        onClick={() => onOpen({ row, kind })}
        title={
          row.documentCount > 0
            ? `${row.documentCount} attached`
            : "Nothing attached to this entry"
        }
        className="num inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
      >
        {row.documentCount === 0 ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : null}
        {children}
      </button>
    </td>
  );
}

/**
 * The rate a single row carries.
 *
 * `fxRate` first because it is realised — the bank actually converted at it —
 * and `usdRate` after, which is the reference rate captured on the day. Same
 * order the server uses, so a row reads the same here as in a report.
 */
function rateOf(row: TransactionDto): string | null {
  const rate = row.fxRate ?? row.usdRate;
  return rate && Number(rate) > 0 ? rate : null;
}

/** Taka read in dollars. A translation, never a recorded figure. */
/**
 * How many dollars a row is, in one place.
 *
 * The stored figure when there is one — that is what the sender actually sent,
 * off the remittance advice. Divided out only when there is not, and the
 * approximate mark on screen says which of the two a reader is looking at.
 *
 * One function because the column and the total above it must agree. They are
 * the same question asked twice, and two implementations would differ on
 * exactly the rows where the bank took a charge.
 */
function dollarsOf(
  row: TransactionDto,
  monthRate: string | null,
): string | null {
  if (row.originalCurrency === "USD" && row.originalAmount) {
    return row.originalAmount;
  }
  const rate = rateOf(row) ?? monthRate;
  return rate ? inDollars(row.amount, rate) : null;
}

function inDollars(amountBdt: string, rate: string): string {
  return (Number(amountBdt) / Number(rate)).toFixed(2);
}

/** 122.770000 reads as a database artefact; 122.77 reads as a rate. */
function trimRate(rate: string): string {
  const trimmed = rate.includes(".") ? rate.replace(/0+$/, "") : rate;
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}
