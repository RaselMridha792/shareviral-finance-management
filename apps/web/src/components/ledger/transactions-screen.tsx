"use client";

import { ArrowLeftRight, Download, LoaderCircle, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import {
  exportUrl,
  ledgerApi,
  type LedgerSummary,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { FilterBar, type LedgerFilters } from "./filter-bar";
import { TransactionForm } from "./transaction-form";
import { TransactionTable } from "./transaction-table";
import { TransferForm } from "./transfer-form";
import { VoidDialog } from "./void-dialog";

const PAGE_SIZE = 50;

export function TransactionsScreen({
  accounts,
  categories,
}: {
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canWrite = useCan("transactions.write");
  const canExport = useCan("exports.run");

  const [filters, setFilters] = useState<LedgerFilters>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [voiding, setVoiding] = useState<TransactionDto | null>(null);

  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = { ...filters, page, pageSize: PAGE_SIZE };
      const [list, totals] = await Promise.all([
        ledgerApi.list(query),
        ledgerApi.summary(filters as Record<string, string | undefined>),
      ]);
      // A slower earlier request must not overwrite a faster later one.
      if (request !== requestRef.current) return;
      setRows(list.items);
      setTotalPages(list.totalPages);
      setTotal(list.total);
      setSummary(totals);
    } catch (caught) {
      if (request !== requestRef.current) return;
      setError(
        caught instanceof ApiError ? caught.message : "Could not load entries.",
      );
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    // Fetching from the API when the filters or page change — the rule's own
    // "subscribe to an external system" case. The setState calls happen in the
    // await continuation, not during render, so there is no cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A changed filter means the current page number is meaningless.
  function changeFilters(next: LedgerFilters) {
    setFilters(next);
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every movement of money, in and out."
        actions={
          <>
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  window.location.href = exportUrl("transactions", {
                    ...filters,
                    page: 1,
                    pageSize: 20000,
                  });
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
            {canWrite ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setTransferring(true)}
                >
                  <ArrowLeftRight className="size-4" />
                  Transfer
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-4" />
                  Record
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryTile label="Money in" value={summary?.moneyIn} tone="in" />
        <SummaryTile label="Money out" value={summary?.moneyOut} tone="out" />
        <SummaryTile
          label="Net"
          value={summary?.net}
          hint={
            summary ? `${summary.entries} entries in this view` : undefined
          }
        />
      </div>

      <FilterBar
        filters={filters}
        accounts={accounts}
        categories={categories}
        onChange={changeFilters}
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <Card className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading…
        </Card>
      ) : (
        <TransactionTable
          rows={rows}
          onEdit={setEditing}
          onVoid={setVoiding}
          emptyMessage={
            Object.keys(filters).length
              ? "Nothing matches these filters."
              : "No entries yet. Record the first movement to get started."
          }
        />
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page <span className="num">{page}</span> of{" "}
            <span className="num">{totalPages}</span> ·{" "}
            <span className="num">{total}</span> entries
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <datalist id="vendor-options" />

      <TransactionForm
        open={creating}
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
      <TransferForm
        open={transferring}
        accounts={accounts}
        onClose={() => setTransferring(false)}
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

function SummaryTile({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value?: string;
  tone?: "in" | "out" | "neutral";
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {value === undefined ? (
        <div className="mt-3 h-7 w-32 animate-pulse rounded bg-surface-muted" />
      ) : (
        <Amount
          value={value}
          tone={tone === "neutral" ? "auto" : tone}
          className="mt-3 block text-2xl font-semibold tracking-tight"
        />
      )}
      {hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
