"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useNameThisPage } from "@/components/layout/breadcrumb";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { type ExpenseSummary, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { MonthPicker, type Range } from "./month-picker";

export function CategoryDetailScreen({
  heading,
  breakdown,
  rows,
  range,
  accounts,
  categories,
}: {
  heading: CategoryNode;
  breakdown: ExpenseSummary;
  rows: TransactionDto[];
  range: Range;
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  // The rail knows the ancestors; only this page knows the record.
  useNameThisPage(heading.name);

  const router = useRouter();

  const canWrite = useCan("transactions.write");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

  function changeRange(next: Range) {
    router.push(`/expenses/${heading.slug}?from=${next.from}&to=${next.to}`);
  }

  const refresh = () => router.refresh();

  /*
   * The count on the total card has to be counted over the same rows the
   * total was.
   *
   * It used to be `rows.length` — the transactions this screen happened to
   * fetch, one capped page of them — printed beside a figure the server
   * summed over every matching row. Two populations in one card, agreeing
   * only while the heading stayed under the page size. The summary carries
   * `entries` per sub-category, counted by the same query that produced
   * `breakdown.total`, so the sum of those is the honest figure.
   */
  const entries = breakdown.groups.reduce(
    (sum, group) => sum + group.entries,
    0,
  );

  return (
    <>
      <Link
        href="/expenses"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All expenses
      </Link>

      <PageHeader
        title={heading.name}
        icon="sell"
        description={`Spending under this heading in ${range.label}.`}
        actions={
          <>
            <MonthPicker range={range} onChange={changeRange} />
            {/* The button names the heading it adds to, so nobody has to pick
                one from a drawer to record a bill they already know the kind
                of. This is where "Add expense" went when it came off the
                overview. */}
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                add {heading.name}
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ background: heading.color }}
          />
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Total
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {entries} entr{entries === 1 ? "y" : "ies"}
            </p>
          </div>
        </div>
        <Amount
          value={breakdown.total}
          tone="neutral"
          className="text-2xl font-semibold"
        />
      </Card>

      {/*
        The sub-categories as a row of chips, not a table.

        It was a panel with six columns — name, bar, share, entries, amount —
        which is a table's worth of chrome to say where inside one heading the
        money went. The owner asked for the row instead, and it keeps the two
        things people actually read: which sub-categories exist, and roughly
        how the money splits.

        It is also the only way into a sub-category from here, which is what
        makes the breadcrumb's second level reachable. Removing the panel
        without this would have left the page with no way down.
      */}
      {breakdown.groups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {breakdown.groups.map((group) => (
            <Link
              key={group.id}
              href={`/expenses/${group.slug}?from=${range.from}&to=${range.to}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm transition hover:border-primary/50 hover:bg-surface-muted"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: group.color ?? heading.color }}
              />
              {group.name}
              <Amount
                value={group.total}
                tone="neutral"
                className="num text-xs text-muted-foreground"
              />
            </Link>
          ))}
        </div>
      ) : null}

      <TransactionTable
        rows={rows}
        onEdit={setEditing}
        onVoid={setVoiding}
        emptyMessage={`Nothing filed under ${heading.name} in ${range.label}.`}
      />

      <TransactionForm
        key={editing?.id ?? "new"}
        open={creating || Boolean(editing)}
        transaction={editing ?? undefined}
        // A new entry starts under the heading whose page this is.
        defaultCategoryId={heading.id}
        accounts={accounts}
        categories={categories}
        lockDirection
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
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
