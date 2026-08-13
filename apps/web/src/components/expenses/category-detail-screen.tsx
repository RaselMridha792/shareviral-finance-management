"use client";

import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { TransactionForm } from "@/components/ledger/transaction-form";
import { TransactionTable } from "@/components/ledger/transaction-table";
import { VoidDialog } from "@/components/ledger/void-dialog";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  exportUrl,
  type ExpenseSummary,
  type TransactionDto,
} from "@/lib/ledger";
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
  const router = useRouter();
  const canExport = useCan("exports.run");

  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

  function changeRange(next: Range) {
    router.push(
      `/expenses/${heading.slug}?from=${next.from}&to=${next.to}`,
    );
  }

  const refresh = () => router.refresh();

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
        description={`Spending under this heading in ${range.label}.`}
        actions={
          <>
            <MonthPicker range={range} onChange={changeRange} />
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  window.location.href = exportUrl("transactions", {
                    from: range.from,
                    to: range.to,
                    direction: "out",
                    categorySlug: heading.slug,
                    page: 1,
                    pageSize: 20000,
                  });
                }}
              >
                <Download className="size-4" />
                Excel
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
              {rows.length} entr{rows.length === 1 ? "y" : "ies"}
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <tbody className="divide-y divide-border">
                  {breakdown.groups.map((group) => {
                    const share =
                      (Number(group.total) / Number(breakdown.total)) * 100;
                    return (
                      <tr key={group.id} className="row-finance">
                        <td className="px-5 py-2.5 font-medium">
                          {group.name}
                        </td>
                        <td className="px-5 py-2.5">
                          <div className="h-1.5 w-full min-w-24 overflow-hidden rounded-full bg-surface-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(share, 2)}%`,
                                background: heading.color,
                              }}
                            />
                          </div>
                        </td>
                        <td className="num w-16 px-5 py-2.5 text-right text-xs text-muted-foreground">
                          {share.toFixed(0)}%
                        </td>
                        <td className="num w-16 px-5 py-2.5 text-right text-xs text-muted-foreground">
                          {group.entries}
                        </td>
                        <td className="px-5 py-2.5">
                          <Amount
                            value={group.total}
                            tone="neutral"
                            className="block font-medium"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <TransactionTable
        rows={rows}
        onEdit={setEditing}
        onVoid={setVoiding}
        emptyMessage={`Nothing filed under ${heading.name} in ${range.label}.`}
      />

      <datalist id="vendor-options" />

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
