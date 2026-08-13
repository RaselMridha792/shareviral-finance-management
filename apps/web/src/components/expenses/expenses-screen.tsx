"use client";

import { Download, LoaderCircle, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import {
  exportUrl,
  ledgerApi,
  type ExpenseSummary,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
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
  const canWrite = useCan("transactions.write");
  const canExport = useCan("exports.run");

  const [range, setRange] = useState(initialRange);
  const [summary, setSummary] = useState(initialSummary);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

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

  const filters = { from: range.from, to: range.to, direction: "out" as const };

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
        description="What the company spent, grouped by heading."
        actions={
          <>
            <MonthPicker range={range} onChange={setRange} />
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  window.location.href = exportUrl("transactions", filters);
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
            {canWrite ? (
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                <Plus className="size-4" />
                Add expense
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Spent in {range.label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Across {summary.groups.length} heading
            {summary.groups.length === 1 ? "" : "s"}
          </p>
        </div>
        <Amount
          value={summary.total}
          tone="neutral"
          className="text-2xl font-semibold"
        />
      </Card>

      {summary.groups.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Receipt className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              Nothing spent in {range.label}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Record an expense, or step back a month to see an earlier one.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {summary.groups.map((group) => {
            const share = (Number(group.total) / Number(summary.total)) * 100;
            return (
              <Link
                key={group.id}
                href={`/expenses/${group.slug}?from=${range.from}&to=${range.to}`}
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

      <datalist id="vendor-options" />

      <TransactionForm
        open={creating}
        defaultDirection="out"
        accounts={accounts}
        categories={categories}
        onClose={() => setCreating(false)}
        onSaved={load}
      />
      <TransactionForm
        key={editing?.id}
        open={Boolean(editing)}
        transaction={editing ?? undefined}
        accounts={accounts}
        categories={categories}
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
