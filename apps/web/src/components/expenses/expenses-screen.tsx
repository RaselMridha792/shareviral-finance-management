"use client";

import { LoaderCircle, Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryBar } from "@/components/ui/patterns";
import { ApiError } from "@/lib/api-client";
import {
  ledgerApi,
  type ExpenseSummary,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { HeadingChooser, useHiddenHeadings } from "./heading-chooser";
import { MonthPicker, type Range } from "./month-picker";

/** One screenful. Anything past this is said out loud rather than dropped. */
const PAGE_SIZE = 100;

export function ExpensesScreen({
  initialSummary,
  initialRange,
  accounts,
  categories,
}: {
  initialSummary: ExpenseSummary;
  initialRange: Range;
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const [range, setRange] = useState(initialRange);
  const [summary, setSummary] = useState(initialSummary);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

  /*
   * The cards on screen, and the ones the reader has put away.
   *
   * Only the cards. The summary above them counts every heading the period
   * has, and the table below shows every entry — hiding a card is a preference
   * about this screen, not a filter on the company's money.
   */
  const hiddenIds = useHiddenHeadings();
  const shown = summary.groups.filter((g) => !hiddenIds.includes(g.id));
  const hidden = summary.groups.filter((g) => hiddenIds.includes(g.id));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [next, list] = await Promise.all([
        ledgerApi.expenseSummary({ from: range.from, to: range.to }),
        ledgerApi.list({
          from: range.from,
          to: range.to,
          direction: "out",
          page: 1,
          pageSize: PAGE_SIZE,
        }),
      ]);
      setSummary(next);
      setRows(list.items);
      setTotal(list.total);
    } catch (caught) {
      // Without this the screen sat on "Loading…" for ever and never said why.
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

  const errorBanner = error ? (
    <p
      role="alert"
      className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
    >
      {error}
    </p>
  ) : null;

  return (
    <>
      {errorBanner}

      <PageHeader
        title="Expenses"
        icon="receipt_long"
        description="What the company spent, grouped by heading."
        // No "Add expense" here. Adding moved to the heading pages, where the
        // button names the heading it adds to — "add Office & premises" — so
        // nobody has to pick a category from a drawer to record a bill they
        // already know the kind of. This page reads; those pages write.
        actions={
          <>
            <MonthPicker range={range} onChange={setRange} />
            <HeadingChooser
              headings={summary.groups}
              categories={categories}
              onCreated={load}
            />
          </>
        }
      />

      <SummaryBar
        label={`Spent in ${range.label}`}
        icon="north_east"
        iconTone="text-negative"
        description={
          <>
            {/* The count is of what the period has, not of what is on
                screen. Hiding a card is a preference about this screen; the
                money is still spent and still in the total beside it. */}
            Across {summary.groups.length} heading
            {summary.groups.length === 1 ? "" : "s"}
            {hidden.length > 0 ? (
              <>
                {" · "}
                <span className="num">{hidden.length}</span> hidden here
              </>
            ) : null}
          </>
        }
        value={<Amount value={summary.total} tone="neutral" />}
      />

      {summary.groups.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Receipt className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">
              Nothing spent in {range.label}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Record an expense, or step back a month to see an earlier one.
            </p>
          </div>
        </Card>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
          }}
        >
          {shown.map((group) => {
            const share = (Number(group.total) / Number(summary.total)) * 100;
            return (
              // One tile per category — see the note in team-screen.tsx.
              <Link
                key={group.id}
                href={`/expenses/${group.slug}?from=${range.from}&to=${range.to}`}
                prefetch={false}
                className="rounded-xl border border-border bg-surface p-5 shadow-e1 transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ background: group.color }}
                  />
                  <span className="truncate text-sm font-semibold">
                    {group.name}
                  </span>
                </div>
                <Amount
                  value={group.total}
                  tone="neutral"
                  className="mt-4 block text-xl font-semibold tracking-tight"
                />
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(share, 2)}%`,
                      background: group.color,
                    }}
                  />
                </div>
                <p className="num mt-2 text-xs text-muted-foreground">
                  {share.toFixed(0)}% · {group.entries} entr
                  {group.entries === 1 ? "y" : "ies"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader
          title="Every expense this month"
          description={
            total > rows.length
              ? `Showing the most recent ${rows.length} of ${total} — narrow the month or use All transactions to see the rest`
              : `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`
          }
        />
        <CardBody className="p-0">
          {loading ? (
            <p className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading…
            </p>
          ) : (
            <TransactionTable
              rows={rows}
              onEdit={setEditing}
              onVoid={setVoiding}
              emptyMessage="No expenses recorded in this month."
            />
          )}
        </CardBody>
      </Card>

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
