"use client";

import type { TxnDirection } from "@finance/shared";
import { formatMoney } from "@finance/shared";
import { LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DateRangeField,
  FilterBar,
  FilterSelect,
} from "@/components/ui/filters";
import { PageHeader } from "@/components/ui/page-header";
import { StatCell, StatStrip } from "@/components/ui/patterns";
import { SearchField } from "@/components/ui/search-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useTransactionDelete } from "./use-transaction-delete";
import { ApiError, trashApi } from "@/lib/api-client";
import {
  ledgerApi,
  type LedgerSummary,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { PAGE_SIZE } from "@/lib/pagination";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { TransactionForm } from "./transaction-form";
import { TransactionTable } from "./transaction-table";
import { VoidDialog } from "./void-dialog";

/**
 * What this screen asks the API for — and, unchanged, what the Excel export
 * carries, so the download stays exactly what is on screen.
 *
 * Payment method is deliberately not here. The API still accepts the filter
 * and every other screen may keep using it; this one simply never sends the
 * parameter, which the server already reads as "any method".
 */
type LedgerFilters = {
  from?: string;
  to?: string;
  accountId?: string;
  direction?: TxnDirection;
  categoryId?: string;
  q?: string;
  includeVoided?: boolean;
};

/**
 * The whole ledger, read-only at the top.
 *
 * Nothing is created from here any more: money in is recorded from Accounts →
 * Cash-In and money out from the Expenses screens, so a new entry always
 * starts from a screen that knows its direction. The row actions stay — this
 * is still where an entry is corrected or voided.
 */
export function TransactionsScreen({
  accounts,
  categories,
}: {
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const [filters, setFilters] = useState<LedgerFilters>({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const del = useTransactionDelete(() => void load());

  /* Ticking, and the one act it leads to. */
  const bulk = useBulkSelect(rows);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const bulkTotal = bulk.selected
    .reduce((sum, r) => sum + Number(r.amount), 0)
    .toFixed(2);

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
        icon="swap_vert"
        description="Every movement of money, in and out."
      />

      {/*
        The filter above the figures, not below them.

        The three cells answer to it — the Net cell literally says "31 entries
        in this view" — so this is cause above effect. The other way round, a
        reader meets three numbers and only afterwards finds out what decided
        them.
      */}
      <FilterRow
        filters={filters}
        accounts={accounts}
        categories={categories}
        onChange={changeFilters}
      />

      <StatStrip>
        <SummaryTile
          label="Money in"
          icon="south_west"
          iconTone="text-positive"
          value={summary?.moneyIn}
          tone="in"
        />
        <SummaryTile
          label="Money out"
          icon="north_east"
          iconTone="text-negative"
          value={summary?.moneyOut}
          tone="out"
        />
        {/* The one that answers the question, so it sits on the raised surface
            the way a closing figure does everywhere else. */}
        <SummaryTile
          emphasis
          label="Net"
          icon="account_balance_wallet"
          iconTone="text-primary-text"
          value={summary?.net}
          hint={summary ? `${summary.entries} entries in this view` : undefined}
        />
      </StatStrip>

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
        <>
          <BulkBar
            count={bulk.count}
            total={bulkTotal}
            noun="entry"
            pending={bulkPending}
            onClear={bulk.clear}
            onTrash={() => {
              setBulkError(null);
              setBulkAsking(true);
            }}
          />
          <TransactionTable
            rows={rows}
            bulk={bulk}
            onEdit={setEditing}
            onVoid={setVoiding}
            onDelete={del.ask}
            // Both directions appear here, so which one a row is has to be
            // readable rather than inferred from a colour.
            showType
            emptyMessage={
              Object.keys(filters).length
                ? "Nothing matches these filters."
                : "No entries yet. Record the first movement to get started."
            }
          />
        </>
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

      {/* Kept mounted for the row's edit action — this is the same drawer,
          opened with a transaction rather than empty. */}
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
      {del.dialog}

      <DeleteDialog
        open={bulkAsking}
        subject="entry"
        count={bulk.count}
        summary={
          <>
            {bulk.selected
              .slice(0, 5)
              .map((r) => `${r.refNo ?? r.description}`)
              .join(", ")}
            {bulk.count > 5 ? ` and ${bulk.count - 5} more` : ""}
            {" — "}
            {formatMoney(bulkTotal)}
          </>
        }
        consequences="They come out of every total and every report. A transfer takes its other half with it. The trash can put them back."
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(false)}
        onConfirm={(reason) => {
          setBulkPending(true);
          setBulkError(null);
          void trashApi
            .removeMany(
              "transaction",
              bulk.selected.map((r) => r.id),
              reason,
            )
            .then(() => {
              setBulkAsking(false);
              bulk.clear();
              void load();
            })
            .catch((err: unknown) =>
              setBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setBulkPending(false));
        }}
      />
    </>
  );
}

/**
 * Everything that narrows the ledger, on one line.
 *
 * It used to be two: search and the dates above, the selects below. Two rows of
 * chrome is enough to push the first entry off a laptop screen, and this page
 * is read far more often than it is filtered.
 *
 * The widths are budgeted for the tightest case that matters — a 1280px screen
 * with the sidebar open leaves this row 960px. Measured in Chrome at this app's
 * type scale, the seven controls need 936px of it, which is what makes the line
 * hold there; the search box takes the 152px that are left and every pixel
 * gained after that. Why each control is sized the way it is now lives with the
 * control, in ui/filters.tsx.
 */
function FilterRow({
  filters,
  accounts,
  categories,
  onChange,
}: {
  filters: LedgerFilters;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onChange: (next: LedgerFilters) => void;
}) {
  const set = (patch: Partial<LedgerFilters>) =>
    onChange({ ...filters, ...patch });

  const [search, setSearch] = useState(filters.q ?? "");

  // Typing should not fire a request per letter. The filters change only once
  // the person stops; clearing the pending timer is what makes that true.
  useEffect(() => {
    if ((filters.q ?? "") === search.trim()) return;
    const id = setTimeout(
      () => onChange({ ...filters, q: search.trim() || undefined }),
      300,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active =
    Object.entries(filters).filter(
      ([key, value]) =>
        key !== "includeVoided" && value !== undefined && value !== "",
    ).length + (filters.includeVoided ? 1 : 0);

  return (
    <FilterBar>
      {/*
        The placeholder is one word because on the narrowest laptop it has
        eighty pixels to say it in, and a hint reading "Search descri" looks
        like a fault rather than an invitation. What the search covers —
        description, reference, ref no. — is learnt by typing; the magnifier
        and the label carry the rest.

        `min-w-32` is the width at which this row gives up and wraps, not the
        width the box usually gets: it takes everything the others leave.
      */}
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Search"
        label="Search the transactions"
        className="min-w-32 flex-1"
      />

      {/*
        The date pair answers to the screen as well as to its type size: the
        same two fields measure 261px at 1×, 273px at 2× and 285px at 3×,
        Chrome rounding what it draws inside them up to whole device pixels.
        The search box absorbs all of that, which is why its minimum above is
        set low enough to survive the widest of them.
      */}
      <DateRangeField from={filters.from} to={filters.to} onChange={set} />

      <FilterSelect
        label="Direction"
        value={filters.direction ?? ""}
        onChange={(next) =>
          set({ direction: (next || undefined) as TxnDirection | undefined })
        }
      >
        <option value="">In and out</option>
        <option value="in">Money in</option>
        <option value="out">Money out</option>
      </FilterSelect>

      {/* One account is not a choice, so it is only worth the width once there
          are two to pick between. */}
      {accounts.length > 1 ? (
        <FilterSelect
          wide
          label="Account"
          value={filters.accountId ?? ""}
          onChange={(next) => set({ accountId: next || undefined })}
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </FilterSelect>
      ) : null}

      {/*
        The one control in this row deliberately not a FilterSelect. Categories
        are the longest list on the screen and the one people come to the ledger
        to use: scrolling a grouped list to find "Courier and postage" is the
        whole reason the filter gets ignored, and on one line there is even less
        room to read it in. Being able to type the name is worth more here than
        matching the shape of its neighbours.

        "All categories" is an option rather than a cleared value, so undoing
        the filter is in the same place as setting it — and the width is the one
        that shows those two words whole, since that is what the control says
        for as long as nobody has touched it.
      */}
      <SearchableSelect
        className="w-36 shrink-0"
        value={filters.categoryId ?? ""}
        onChange={(next) => set({ categoryId: next || undefined })}
        placeholder="All categories"
        searchPlaceholder="Type to find a category…"
        emptyLabel="No category matches that."
        options={[
          { value: "", label: "All categories" },
          ...categories.flatMap((group) => [
            {
              value: group.id,
              label: `${group.name} (general)`,
              group: group.name,
            },
            ...group.children.map((child) => ({
              value: child.id,
              label: child.name,
              group: group.name,
            })),
          ]),
        ]}
      />

      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={filters.includeVoided ?? false}
          onChange={(event) => set({ includeVoided: event.target.checked })}
          className="size-4 accent-primary"
        />
        Show voided
      </label>

      {/* Last, and the one thing here that is allowed to wrap: it is drawn only
          once a filter is set, and under a 1440px window with the sidebar open
          it wants more room than the row has spare. A chip on a short second
          line reads better than seven controls squeezed to keep it company. */}
      {active > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => {
            // The search box has to be emptied too, not just the filters.
            // Clearing `filters.q` alone left the typed text on screen, and
            // the debounce then saw it differ from the (now empty) filter
            // and re-applied the search 300ms after it was cleared.
            setSearch("");
            onChange({});
          }}
        >
          <X className="size-3.5" />
          Clear {active}
        </Button>
      ) : null}
    </FilterBar>
  );
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
  hint,
  icon,
  iconTone,
  emphasis,
}: {
  label: string;
  value?: string;
  tone?: "in" | "out" | "neutral";
  hint?: string;
  icon?: string;
  iconTone?: string;
  emphasis?: boolean;
}) {
  return (
    <StatCell
      label={label}
      icon={icon}
      iconTone={iconTone}
      emphasis={emphasis}
      value={
        value === undefined ? (
          // Still being fetched, at the height it will land at, so the row does
          // not jump underneath somebody reading it.
          <span className="block h-7 w-32 animate-pulse rounded bg-surface-muted" />
        ) : (
          <Amount
            value={value}
            tone={tone === "neutral" ? "auto" : tone}
            showCounterpart={false}
          />
        )
      }
      footnote={hint}
    />
  );
}
