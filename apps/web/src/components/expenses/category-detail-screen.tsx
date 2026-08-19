"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
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

      {breakdown.groups.length > 0 ? (
        <Card>
          <CardHeader
            title="By sub-category"
            description="Where inside this heading the money went"
          />
          <CardBody className="p-0">
            <TableScroll>
              <table className="table-data min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left">
                    {/* Position in a list sorted by spend, nothing more. These
                        rows are sub-categories, and a sub-category's identity
                        is its name — a number here would invite people to
                        quote "number 3" at each other, which changes meaning
                        the moment the month does. */}
                    <SerialHead />
                    <Th>Sub-category</Th>
                    <Th width="w-36" align="right">
                      Amount (BDT)
                    </Th>
                    {/* The bar is the share drawn, and the column beside it is
                        the same share as a figure. One heading between them,
                        on the number — heading both "Share" would state one
                        fact twice and read as two. The bar itself is hidden
                        from screen readers for the same reason. */}
                    <Th width="w-40" />
                    <Th width="w-16" align="right">
                      Share
                    </Th>
                    <Th width="w-20" align="right">
                      Entries
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.groups.map((group, index) => {
                    const share =
                      (Number(group.total) / Number(breakdown.total)) * 100;
                    return (
                      <tr key={group.id} className="row-finance">
                        <SerialCell n={index + 1} />
                        <td className="font-medium">
                          {/* Opens the sub-category's own page — this same
                              screen, one level down. The slug is already on
                              the row the server sent; nothing is guessed. */}
                          <Link
                            href={`/expenses/${group.slug}`}
                            className="transition hover:text-primary hover:underline"
                          >
                            {group.name}
                          </Link>
                        </td>
                        <td className="text-right">
                          <Amount
                            value={group.total}
                            tone="neutral"
                            className="block font-medium"
                          />
                        </td>
                        <td>
                          <div
                            aria-hidden
                            className="h-1.5 w-full min-w-24 overflow-hidden rounded-full bg-surface-muted"
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(share, 2)}%`,
                                background: heading.color,
                              }}
                            />
                          </div>
                        </td>
                        <td className="num text-right text-xs text-muted-foreground">
                          {share.toFixed(0)}%
                        </td>
                        <td className="num text-right text-xs text-muted-foreground">
                          {group.entries}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </CardBody>
        </Card>
      ) : null}

      <TransactionTable
        rows={rows}
        onEdit={setEditing}
        onVoid={setVoiding}
        emptyMessage={`Nothing filed under ${heading.name} in ${range.label}.`}
      />

      <TransactionForm
        key={editing?.id}
        open={Boolean(editing)}
        transaction={editing ?? undefined}
        accounts={accounts}
        categories={categories}
        lockDirection
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
