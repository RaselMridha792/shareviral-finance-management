"use client";

import { ACCOUNT_TYPE_LABELS, type AccountType } from "@finance/shared";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { useCan } from "@/components/auth/session-provider";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { useTransactionDelete } from "@/components/ledger/use-transaction-delete";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { type RegisterResult, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { PAGE_SIZE, pageCount } from "@/lib/pagination";
import { formatDate, cn } from "@/lib/utils";

/**
 * The bank register: one account's entries, newest first, with the balance
 * after each one.
 *
 * This is the screen that has to match the bank statement line for line — which
 * is why the four figures at the top are stated plainly and the running balance
 * is on every row.
 */
export function RegisterScreen({
  register,
  range,
  accounts,
  categories,
}: {
  register: RegisterResult;
  range: { from?: string; to?: string };
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const router = useRouter();
  const canWrite = useCan("transactions.write");

  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);
  const [page, setPage] = useState(1);

  const { account } = register;

  /**
   * Newest first on screen, oldest first in the arithmetic.
   *
   * The API orders this account's rows by date ascending because the Balance
   * column is a window function over exactly that order — turn the query round
   * and every figure in it changes. So the reversal happens here, after each
   * row already carries the balance it left behind, and the Balance column is
   * untouched: the top row is the most recent entry and the number beside it is
   * the account's closing balance, which is what somebody opening a register
   * has come to see. It cost a scroll past every entry the account ever had
   * before — this one runs to 704 rows on the live data.
   *
   * A copy, not `register.rows.reverse()` — that reverses the array the props
   * hold, so the next render on the same data would turn the register back
   * round. The statement screen learnt this the same way.
   */
  const ordered = useMemo(() => [...register.rows].reverse(), [register.rows]);

  const totalPages = pageCount(ordered.length);
  /*
   * Clamped rather than reset.
   *
   * The two dates are the only things that shorten this list, and both already
   * send the reader back to page 1 through `setRange`. The clamp is for what a
   * filter change cannot do anything about — a page number that outlives the
   * rows it pointed at, most obviously when an entry is voided away or the
   * refresh after a save returns a shorter list, which would otherwise draw an
   * empty table on a register that plainly has entries in it.
   */
  const current = Math.min(page, totalPages);
  const visible = ordered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // The rail knows the ancestors; only this page knows the record. After the
  // destructure, not before it — `account` comes out of `register`.
  useNameThisPage(`${account.name} — register`);

  const refresh = () => router.refresh();

  const del = useTransactionDelete(() => refresh());

  function setRange(next: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    /*
     * A narrower period is a shorter register, and page 6 of it may not exist.
     * The route does not change here, only its query, so React keeps this
     * component and its page number alive across the navigation unless it is
     * put back.
     */
    setPage(1);
    router.push(`/accounts/${account.id}/register?${params}`);
  }

  return (
    <>
      <Link
        href={`/accounts/${account.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {account.name}
      </Link>

      <PageHeader
        title={account.name}
        icon="description"
        description={[
          ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type,
          account.bankName,
          account.accountNumber,
        ]
          .filter(Boolean)
          .join(" · ")}
        /*
         * No "Record" button, on the owner's word: "ekhane kono record manually
         * add korbona". This page is a register — it shows what reached the
         * account, and every one of those entries is made where the money is
         * actually recorded (an expense, a cash-in, a transfer). A button here
         * offered a second door to the same act, and an entry made through it
         * looked like a correction to the account's own history.
         *
         * Editing a row and voiding one stay: those act on what is already
         * here, which is what a register is for.
         */
      />

      {/*
        A tin of cash cannot hold less than nothing, and a bKash wallet cannot
        go below zero — the provider refuses the payment. So a negative closing
        balance on either is never a fact about the money; it is the records
        saying something is missing from them, and the register is where the
        missing thing gets found.

        Bank accounts are excluded on purpose: an overdraft is real, and warning
        about a true figure teaches people to ignore warnings.
      */}
      {(account.type === "cash" || account.type === "mobile_wallet") &&
      register.closingBalance.trim().startsWith("-") ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-medium">This balance cannot be right.</span>{" "}
            {ACCOUNT_TYPE_LABELS[account.type as AccountType]} cannot hold less
            than nothing. Something is missing from the entries below — most
            often money put into this account that was never recorded. The list
            runs newest first, so read the Balance column upwards from the
            oldest entry and find the day it first went under; whatever came in
            around then is what has not been entered.
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="date"
            defaultValue={range.from ?? ""}
            onChange={(event) =>
              setRange({ ...range, from: event.target.value || undefined })
            }
            className={cn(controlClass, "num w-40")}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input
            type="date"
            defaultValue={range.to ?? ""}
            onChange={(event) =>
              setRange({ ...range, to: event.target.value || undefined })
            }
            className={cn(controlClass, "num w-40")}
          />
        </label>
        {range.from || range.to ? (
          <Button size="sm" variant="ghost" onClick={() => setRange({})}>
            All entries
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Opening"
          value={register.openingBalance}
          hint={
            range.from
              ? `Everything up to ${range.from}`
              : `Since ${formatDate(account.openingBalanceOn)}`
          }
        />
        <Figure label="Money in" value={register.totalIn} tone="in" />
        <Figure label="Money out" value={register.totalOut} tone="out" />
        <Figure
          label="Closing"
          value={register.closingBalance}
          hint="Should equal the bank statement"
          emphasis
        />
      </div>

      <TransactionTable
        rows={visible}
        // Which slice this is, so the SL column keeps counting across the page
        // break instead of starting a second row 1 twenty lines later.
        page={current}
        onEdit={setEditing}
        onVoid={setVoiding}
        onDelete={del.ask}
        showAccount={false}
        showBalance
        emptyMessage="No entries for this account in the chosen period."
      />

      {/* A sibling of the table, never inside its empty branch — the page
          somebody most needs this control on is the one that came up empty, and
          a pager drawn inside the table is the one that is not there. It draws
          nothing at all while a register fits on one page. */}
      <Pagination
        page={current}
        totalPages={totalPages}
        total={ordered.length}
        noun="entry"
        nounPlural="entries"
        onPage={setPage}
      />

      <TransactionForm
        key={editing?.id}
        open={Boolean(editing)}
        transaction={editing ?? undefined}
        accounts={accounts}
        categories={categories}
        onClose={() => setEditing(null)}
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

function Figure({
  label,
  value,
  hint,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "in" | "out" | "neutral";
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("p-5", emphasis && "border-primary/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {/* No `currency`: `Amount` falls back to the base, which is what every
          figure in this register is in — `account.currency` names the account,
          not the money. */}
      <Amount
        value={value}
        tone={tone === "neutral" ? "auto" : tone}
        className="mt-3 block text-xl font-semibold tracking-tight"
      />
      {hint ? (
        <p className="num mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
