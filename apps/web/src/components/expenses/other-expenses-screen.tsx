"use client";

import { fromMinorUnits, toMinorUnits } from "@finance/shared";
import { LoaderCircle, Plus, ShoppingBag } from "lucide-react";
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
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
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

      <Card className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Spent in {range.label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {recurringRows > 0 ? (
              <>
                <span className="num">{recurringRows}</span> recurring payment
                {recurringRows === 1 ? "" : "s"} left out —{" "}
                <Link
                  href="/vendors"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  AI tools and subscriptions
                </Link>
              </>
            ) : (
              "Subscriptions and AI tools are counted on their own screen"
            )}
          </p>
        </div>
        <Amount
          value={spent}
          tone="neutral"
          className="text-2xl font-semibold"
        />
      </Card>

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
              <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
                <ShoppingBag className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  Nothing but subscriptions in {range.label}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Record an expense, or step back a month to see an earlier one.
                </p>
              </div>
            </div>
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
