"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SummaryBar } from "@/components/ui/patterns";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type ExpenseSummary } from "@/lib/ledger";
import { categoriesApi, type CategoryNode } from "@/lib/masters";
import {
  HeadingChooser,
  headingsFor,
  isShown,
  useHeadingChoice,
} from "./heading-chooser";
import { MonthPicker, type Range } from "./month-picker";

export function ExpensesScreen({
  initialSummary,
  initialRange,
  categories,
}: {
  initialSummary: ExpenseSummary;
  initialRange: Range;
  categories: CategoryNode[];
}) {
  const [range, setRange] = useState(initialRange);
  const [summary, setSummary] = useState(initialSummary);
  const [tree, setTree] = useState(categories);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The cards on screen, and the ones the reader has put away.
   *
   * Only the cards. The summary above them counts every heading the period
   * has — hiding a card is a preference about this screen, not a filter on the
   * company's money — and a card can be here with nothing against it yet,
   * because somebody asked to watch that heading.
   */
  const picked = useHeadingChoice();
  const headings = useMemo(
    () => headingsFor(summary.groups, tree),
    [summary.groups, tree],
  );
  const cards = headings.filter((h) => isShown(picked, h));
  const hidden = headings.filter((h) => h.hasSpend && !isShown(picked, h));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Both, because a heading created from the drawer has to reach the list
      // it is ticked on in, and it has no spend to bring it back in the
      // summary.
      const [next, categoriesNow] = await Promise.all([
        ledgerApi.expenseSummary({ from: range.from, to: range.to }),
        categoriesApi.tree(),
      ]);
      setSummary(next);
      setTree(categoriesNow);
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
              headings={headings}
              categories={tree}
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

      {cards.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Receipt className="size-6" />
          </span>
          {/* An empty grid has two causes and they are not the same news:
              nothing was spent, or everything that was is ticked off. */}
          <div>
            <p className="text-lg font-semibold">
              {summary.groups.length === 0
                ? `Nothing spent in ${range.label}`
                : "Every heading is ticked off this screen"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {summary.groups.length === 0
                ? "Record an expense, step back a month to see an earlier one, or use add category to keep a heading on screen from now on."
                : "The money is still in the total above. Use add category to put the cards back."}
            </p>
          </div>
        </Card>
      ) : (
        <div
          aria-busy={loading}
          className={`grid gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
          }}
        >
          {cards.map((group) => {
            // A month with nothing in it makes every share 0/0. Nought is the
            // honest answer there, not NaN%.
            const spent = Number(summary.total);
            const share = spent > 0 ? (Number(group.total) / spent) * 100 : 0;
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
    </>
  );
}
