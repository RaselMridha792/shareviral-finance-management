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
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { reportsApi } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { CashInForm } from "./cash-in-form";

/**
 * Money arriving from abroad, month by month.
 *
 * The strip above the table carries the number the rest of the app depends on:
 * the rate the month is running at. Every taka figure elsewhere is read back in
 * dollars at the rate the month's first funding landed at, so this is where a
 * reader finds out which rate that was and which transfer set it.
 *
 * That rate is *asked for*, not worked out here. It used to be recomputed on
 * this screen from the rows it had already loaded, a second copy of a rule that
 * decides every dollar figure in the app and that the API answers directly:
 * `/reports/overview` returns `usdRate` for a period, resolved by
 * `FxService.fundingRateFor` with the Settings rate behind it. One rule, one
 * implementation — this screen can no longer drift away from the reports.
 */
export function CashInScreen({
  accounts,
  categories,
}: {
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canWrite = useCan("transactions.write");
  /**
   * The overview needs `dashboard.money`; this screen needs `accounts.read`.
   * A role can hold the second without the first, and the rate is a detail on
   * a page whose subject is the receipts — so it is asked for only when it can
   * be, and its absence takes nothing else down.
   */
  const canSeeRate = useCan("dashboard.money");
  const { fiscalYearMode } = useSettings();

  const [month, setMonth] = useState(() => todayInDhaka().slice(0, 7));
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
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
      const page = await ledgerApi.list({
        from,
        to,
        direction: "in",
        pageSize: 200,
        sort: "txnDate",
        order: "desc",
      });
      // A slower earlier request must not overwrite a faster later one.
      if (request !== requestRef.current) return;
      setRows(page.items);
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

  /**
   * Which entry the month's rate came off — for the caption only.
   *
   * Found over every money-in row, transfers included, because the server's
   * rule is written that way. The *rate* shown is still the API's: if this
   * attribution and that number ever disagree, the number is the one that is
   * right, and showing it means the screen cannot quietly be wrong about the
   * figure while being confident about the name.
   */
  const setBy = firstFunded(rows);

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

  return (
    <>
      <PageHeader
        title="Cash in"
        actions={
          <>
            <input
              type="month"
              value={month}
              onChange={(event) =>
                setMonth(event.target.value || todayInDhaka().slice(0, 7))
              }
              // Named for a screen reader rather than by a caption above it:
              // this row is one line of h-9 controls, and a stacked label
              // would be the only thing in it standing two rows tall.
              aria-label="Month"
              className={cn(controlClass, "num h-9 w-44")}
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

      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          // The rate card is not shown to a reader who cannot be told it, and
          // one card spread across two columns looks like one went missing.
          rateStatus === "hidden" ? null : "sm:grid-cols-2",
        )}
      >
        <Card className="p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Received in {range.label}
          </p>
          <Amount
            value={totalBdt}
            tone="in"
            className="mt-3 block text-2xl font-semibold tracking-tight"
          />
          {totalUsd ? (
            <Amount
              value={totalUsd}
              currency="USD"
              tone="neutral"
              approximate
              className="mt-0.5 block text-xs text-muted-foreground"
            />
          ) : rateStatus === "ready" ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              No rate on record for this month
            </p>
          ) : null}
        </Card>

        {rateStatus === "hidden" ? null : (
          <Card className={cn("p-5", rate && "border-primary/40")}>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Rate this month
            </p>
            <span className="col-amount mt-3 block text-2xl font-semibold tracking-tight">
              {rateStatus === "loading"
                ? "…"
                : rate
                  ? `৳${trimRate(rate)}`
                  : "—"}
            </span>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {rateStatus === "loading" ? (
                "Asking the API what rate this month is running at."
              ) : !rate ? (
                "Nothing funded yet this month, and no rate set in Settings."
              ) : setBy ? (
                <>
                  Set by <span className="num">{setBy.refNo}</span> on{" "}
                  <span className="num">{setBy.txnDate}</span> — every taka
                  figure this month is read in dollars at it.
                </>
              ) : (
                "Nothing funded this month — this is the fallback rate reports use."
              )}
            </p>
          </Card>
        )}
      </div>

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
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Landmark className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
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
          <div className="overflow-x-auto">
            <table className="table-data min-w-[1220px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  {/* Row order, like the sheet's own SL — not a stored number.
                      Every entry already carries `ref_no`, and a second
                      identity that renumbers itself when a row is voided would
                      be one people quote at each other and get wrong. */}
                  <Th className="text-right">SL</Th>
                  <Th>Invoice No.</Th>
                  <Th>Description</Th>
                  <Th className="text-right">Amount (BDT)</Th>
                  <Th className="text-right">Amount (USD)</Th>
                  <Th className="text-right">Rate</Th>
                  <Th>Transaction ID</Th>
                  {/* Ours — the account the money landed in. The column after
                      it is the other end of the wire, and both of them are a
                      bank account: only the two headings say which side each
                      one is. */}
                  <Th>Received Bank Name</Th>
                  <Th>Sender</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {received.map((row, index) => {
                  // What was actually sent, when the entry recorded it. Only
                  // divided out when it did not: a derived figure is the app's
                  // arithmetic, and the stored one is the remittance advice.
                  const sentUsd = dollarsOf(row, rate);
                  return (
                    <tr
                      key={row.id}
                      className="row-finance hover:bg-surface-muted/50"
                    >
                      <td className="num px-4 py-2.5 text-right text-muted-foreground">
                        {index + 1}
                      </td>
                      <DocumentCell
                        row={row}
                        kind="invoice"
                        onOpen={setDocumentsFor}
                      >
                        {row.invoiceNo}
                      </DocumentCell>
                      <td className="cell-prose px-4 py-2.5">
                        <span className="font-medium">{row.description}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Amount
                          value={row.amount}
                          tone="in"
                          showCounterpart={false}
                          className="block"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
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
                      <td className="col-amount px-4 py-2.5 text-muted-foreground">
                        {/* The rate this row was recorded at — not the month's,
                            unless this row is the one that set it. */}
                        {rateOf(row)
                          ? `৳${trimRate(rateOf(row) as string)}`
                          : "—"}
                      </td>
                      <DocumentCell
                        row={row}
                        kind="bank_statement"
                        onOpen={setDocumentsFor}
                      >
                        {row.reference}
                      </DocumentCell>
                      <td className="px-4 py-2.5">
                        {/* Opens the account itself — its bank, branch, number
                            and what it holds now — rather than this screen's
                            own list. "Which account did that land in, and what
                            is in it" is one question, and it was two pages. */}
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
                        {/* One name, the way the sheet has it. The advice also
                            gives the sending bank, the account number and a
                            SWIFT code; those stay on the entry rather than
                            crowd a column the sheet writes as one sender. */}
                        {row.senderAccountName ?? row.senderBankName ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="max-w-[18rem] px-4 py-2.5 text-muted-foreground">
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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

      <CashInForm
        open={recording}
        accounts={accounts}
        categories={categories}
        onClose={() => setRecording(false)}
        // Both: a transfer recorded into an empty month is the entry that sets
        // the rate, so the strip is stale the moment the table is not.
        onSaved={async () => {
          await Promise.all([load(), loadRate()]);
        }}
      />
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
    return <td className="px-4 py-2.5 text-muted-foreground">—</td>;
  }

  return (
    <td className="px-4 py-2.5">
      <button
        type="button"
        onClick={() => onOpen({ row, kind })}
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

/**
 * Which entry set the month's rate — the name, never the number.
 *
 * The first funded money-in of the period, earliest date then earliest
 * entered, which is the row `FxService.fundingRateFor` reads the rate off. It
 * is found here only because the API returns the rate without saying where it
 * came from, and the caption is more use naming the transfer than not.
 *
 * This deliberately does not return a rate. That question has one answer and
 * the API gives it; if this attribution and that number ever disagree, the
 * number is the one to trust.
 */
function firstFunded(rows: TransactionDto[]): TransactionDto | null {
  const funded = rows
    .filter((row) => rateOf(row) !== null)
    .sort((a, b) =>
      a.txnDate === b.txnDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.txnDate.localeCompare(b.txnDate),
    );

  return funded[0] ?? null;
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
