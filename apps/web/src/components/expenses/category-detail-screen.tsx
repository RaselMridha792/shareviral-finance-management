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
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { type ExpenseSummary, type TransactionDto } from "@/lib/ledger";
import { PAGE_SIZE, pageCount } from "@/lib/pagination";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { CategorySummaryPanel } from "./category-summary-panel";
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

  /*
   * Which sub-category the panel and the table are scoped to, or null for the
   * whole heading.
   *
   * It resets on a month change without being told to: the page keys this
   * screen by the range, so stepping a month remounts it rather than carrying
   * a filter that belongs to a month nobody is looking at any more.
   */
  const [scope, setScope] = useState<string | null>(null);
  const scoped = scope
    ? rows.filter((row) => row.categoryId === scope)
    : rows;
  const scopeName =
    breakdown.groups.find((group) => group.id === scope)?.name ?? null;

  /*
   * Twenty rows to a page, newest first — the app's rule, and `rows` arrives
   * here whole rather than capped, so a page number always points at rows that
   * exist.
   *
   * `current` is clamped rather than reset. Voiding the last row of the last
   * page shortens the list under the reader, and a page number past the end
   * would leave them on an empty table until they touched the control. Picking
   * a sub-category *does* reset it: page 3 of everything is not page 3 of one
   * heading's corner, and landing there would look like an empty result.
   */
  const [page, setPage] = useState(1);
  const totalPages = pageCount(scoped.length);
  const current = Math.min(page, totalPages);
  const visible = scoped.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function changeScope(next: string | null) {
    setScope(next);
    setPage(1);
  }

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

      {/*
        The total and the sub-categories, welded into one panel.

        They were two blocks: a thin full-width total strip, and under it a
        wrapping row of rounded pills. The pills read as decorative tags —
        nothing said they were this heading's sub-categories, and nothing said
        what clicking one did. What it did was navigate to
        `/expenses/<sub-slug>`, and that route resolves top-level headings
        only, so every one of them landed on a 404. They filter in place now.
      */}
      <CategorySummaryPanel
        headingName={heading.name}
        headingColor={heading.color}
        rangeLabel={range.label}
        total={breakdown.total}
        entries={entries}
        groups={breakdown.groups}
        selectedId={scope}
        onSelect={changeScope}
      />

      <TransactionTable
        rows={visible}
        // So the SL column keeps counting across pages: the first row of page
        // two is 21, not 1. On a finance screen that number is what somebody
        // reads down the phone.
        page={current}
        onEdit={setEditing}
        onVoid={setVoiding}
        emptyMessage={
          scopeName
            ? `Nothing filed under ${scopeName} in ${range.label}.`
            : `Nothing filed under ${heading.name} in ${range.label}.`
        }
      />

      {/* A sibling of the table, never inside its empty branch — the page
          somebody most needs this control on is the one that came up empty.
          It draws nothing at all while the month fits on one page. */}
      <Pagination
        page={current}
        totalPages={totalPages}
        total={scoped.length}
        noun="entry"
        nounPlural="entries"
        onPage={setPage}
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
