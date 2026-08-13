"use client";

import { monthRange, todayInDhaka } from "@finance/shared";
import { Landmark, LoaderCircle, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { CashInForm } from "./cash-in-form";

/**
 * Money arriving from abroad, month by month.
 *
 * The strip above the table carries the number the rest of the app depends on:
 * the rate the month is running at. Every taka figure elsewhere is read back in
 * dollars at the rate the month's first funding landed at, so this is where a
 * reader finds out which rate that was and which transfer set it.
 */
export function CashInScreen({
  accounts,
  categories,
}: {
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canWrite = useCan("transactions.write");

  const [month, setMonth] = useState(() => todayInDhaka().slice(0, 7));
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const requestRef = useRef(0);
  const range = monthRange(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

  const from = range.start;
  const to = range.end;

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

  useEffect(() => {
    // Fetching from the API when the month changes — the rule's own "subscribe
    // to an external system" case. The setState calls happen in the await
    // continuation, not during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Moving our own money between our own accounts is not money received, but
   * it does land as a money-in row in the account it arrives in. Counting it
   * here would inflate what the company was sent.
   */
  const received = rows.filter((row) => !row.transferGroupId);

  // Computed over every money-in row, transfers included, because the rule on
  // the server is written that way and two answers to "what rate is this month
  // running at" would be one too many.
  const governing = governingRateOf(rows);
  const rate = governing?.rate ?? null;

  const totalBdt = received
    .reduce((sum, row) => sum + Number(row.amount), 0)
    .toFixed(2);

  // Each row at the rate it was recorded at, falling back to the month's own.
  // Dividing the total by one rate would quietly restate a transfer that
  // arrived at a different one.
  const totalUsd = rate
    ? received
        .reduce(
          (sum, row) => sum + Number(inDollars(row.amount, rateOf(row) ?? rate)),
          0,
        )
        .toFixed(2)
    : null;

  return (
    <>
      <PageHeader
        title="Cash in"
        description="Money received from abroad, and the rate each transfer landed at."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setRecording(true)}
            >
              <Plus className="size-4" />
              Record cash in
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Month</span>
          <input
            type="month"
            value={month}
            onChange={(event) =>
              setMonth(event.target.value || todayInDhaka().slice(0, 7))
            }
            className={cn(controlClass, "num w-44")}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              No rate on record for this month
            </p>
          )}
        </Card>

        <Card className={cn("p-5", rate && "border-primary/40")}>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Rate this month
          </p>
          <span className="col-amount mt-3 block text-2xl font-semibold tracking-tight">
            {rate ? `৳${trimRate(rate)}` : "—"}
          </span>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {governing ? (
              <>
                Set by{" "}
                <span className="num">{governing.row.refNo}</span> on{" "}
                <span className="num">{governing.row.txnDate}</span> — every
                taka figure this month is read in dollars at it.
              </>
            ) : (
              "Nothing funded yet this month. Reports fall back to the rate in Settings."
            )}
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Transfers
          </p>
          <span className="num mt-3 block text-2xl font-semibold tracking-tight">
            {received.length}
          </span>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Moves between our own accounts are not counted here.
          </p>
        </Card>
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
            <table className="table-data min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <Th>Date</Th>
                  <Th>Transaction id</Th>
                  <Th>Description</Th>
                  <Th>Sent from</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Rate</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {received.map((row) => {
                  const rowRate = rateOf(row) ?? rate;
                  return (
                    <tr
                      key={row.id}
                      className="row-finance hover:bg-surface-muted/50"
                    >
                      <td className="num px-4 py-2.5 whitespace-nowrap">
                        {row.txnDate}
                      </td>
                      <td className="num px-4 py-2.5 text-muted-foreground">
                        {row.reference ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{row.description}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {row.accountName ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Sender row={row} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Amount value={row.amount} tone="in" className="block" />
                        {rowRate ? (
                          <Amount
                            value={inDollars(row.amount, rowRate)}
                            currency="USD"
                            tone="neutral"
                            approximate
                            className="mt-0.5 block text-xs text-muted-foreground"
                          />
                        ) : null}
                      </td>
                      <td className="col-amount px-4 py-2.5 text-muted-foreground">
                        {/* The rate this row was recorded at — not the month's,
                            unless this row is the one that set it. */}
                        {rateOf(row) ? `৳${trimRate(rateOf(row) as string)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CashInForm
        open={recording}
        accounts={accounts}
        categories={categories}
        onClose={() => setRecording(false)}
        onSaved={load}
      />
    </>
  );
}

/** The sending bank and the account it left, when the advice named them. */
function Sender({ row }: { row: TransactionDto }) {
  const account = [row.senderAccountName, row.senderAccountNumber]
    .filter(Boolean)
    .join(" · ");

  if (!row.senderBankName && !account) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="flex flex-col">
      <span>{row.senderBankName ?? "—"}</span>
      {account ? (
        <span className="num mt-0.5 block text-xs text-muted-foreground">
          {account}
        </span>
      ) : null}
      {row.senderSwiftCode ? (
        <span className="num mt-0.5 block text-xs text-muted-foreground">
          SWIFT {row.senderSwiftCode}
        </span>
      ) : null}
    </span>
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
 * The rate the month is running at.
 *
 * Mirrors `FxService.fundingRateFor` on the API: the first funded money-in of
 * the period — earliest date, then earliest entered — sets it, and everything
 * afterwards is read back in dollars at that rate. Computed here from rows this
 * screen already has rather than fetched, but it is the server's rule, and the
 * two must not drift: if that one changes, this changes with it.
 */
function governingRateOf(
  rows: TransactionDto[],
): { rate: string; row: TransactionDto } | null {
  const funded = rows
    .filter((row) => rateOf(row) !== null)
    .sort((a, b) =>
      a.txnDate === b.txnDate
        ? a.createdAt.localeCompare(b.createdAt)
        : a.txnDate.localeCompare(b.txnDate),
    );

  const first = funded[0];
  const rate = first ? rateOf(first) : null;
  return first && rate ? { rate, row: first } : null;
}

/** Taka read in dollars. A translation, never a recorded figure. */
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
