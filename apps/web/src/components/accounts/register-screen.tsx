"use client";

import { ACCOUNT_TYPE_LABELS, type AccountType } from "@finance/shared";
import { ArrowLeft, Download, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import {
  exportUrl,
  type RegisterResult,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";

/**
 * The bank register: every entry in date order with the balance after each one.
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
  const canExport = useCan("exports.run");

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

  const { account } = register;
  const refresh = () => router.refresh();

  function setRange(next: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    router.push(`/accounts/${account.id}?${params}`);
  }

  return (
    <>
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All accounts
      </Link>

      <PageHeader
        title={account.name}
        description={[
          ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type,
          account.bankName,
          account.accountNumber,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  window.location.href = exportUrl(
                    `register/${account.id}`,
                    range,
                  );
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Record
              </Button>
            ) : null}
          </>
        }
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
            often money put into this account that was never recorded. Work down
            the list and find the day the balance first went under; whatever came
            in around then is what has not been entered.
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
          currency={account.currency}
          hint={
            range.from
              ? `Everything up to ${range.from}`
              : `Since ${account.openingBalanceOn}`
          }
        />
        <Figure
          label="Money in"
          value={register.totalIn}
          currency={account.currency}
          tone="in"
        />
        <Figure
          label="Money out"
          value={register.totalOut}
          currency={account.currency}
          tone="out"
        />
        <Figure
          label="Closing"
          value={register.closingBalance}
          currency={account.currency}
          hint="Should equal the bank statement"
          emphasis
        />
      </div>

      <TransactionTable
        rows={register.rows}
        onEdit={setEditing}
        onVoid={setVoiding}
        showAccount={false}
        showBalance
        emptyMessage="No entries for this account in the chosen period."
      />

      <TransactionForm
        open={creating}
        defaultAccountId={account.id}
        accounts={accounts}
        categories={categories}
        onClose={() => setCreating(false)}
        onSaved={refresh}
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
    </>
  );
}

function Figure({
  label,
  value,
  currency,
  hint,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string;
  /** The account's own currency — a USD account must not print ৳. */
  currency: string;
  hint?: string;
  tone?: "in" | "out" | "neutral";
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("p-5", emphasis && "border-primary/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <Amount
        value={value}
        currency={currency}
        tone={tone === "neutral" ? "auto" : tone}
        className="mt-3 block text-xl font-semibold tracking-tight"
      />
      {hint ? (
        <p className="num mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
