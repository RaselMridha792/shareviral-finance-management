"use client";

import type { TxnDirection } from "@finance/shared";
import { Download, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ApiError } from "@/lib/api-client";
import {
  exportUrl,
  ledgerApi,
  type LedgerSummary,
  type TransactionDto,
} from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { TransactionForm } from "./transaction-form";
import { TransactionTable } from "./transaction-table";
import { VoidDialog } from "./void-dialog";

const PAGE_SIZE = 50;

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
  const canExport = useCan("exports.run");

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
          canExport ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                // The filter only. The sheet is every matching row, not the
                // page being looked at.
                window.location.href = exportUrl("transactions", filters);
              }}
            >
              <Download className="size-4" />
              Excel
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryTile label="Money in" value={summary?.moneyIn} tone="in" />
        <SummaryTile label="Money out" value={summary?.moneyOut} tone="out" />
        <SummaryTile
          label="Net"
          value={summary?.net}
          hint={summary ? `${summary.entries} entries in this view` : undefined}
        />
      </div>

      <FilterRow
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
          // Both directions appear here, so which one a row is has to be
          // readable rather than inferred from a colour.
          showType
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
 * gained after that. Each of the others carries a width it will not shrink past
 * instead of being allowed to squeeze: a picker on this project has already
 * been collapsed to nothing once by neighbours that all held a fixed width, and
 * `flex-wrap` against honest minimums is what makes the row drop to a second
 * line rather than do that again.
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
    <div className="flex flex-wrap items-center gap-2">
      {/*
        No Search button here, unlike the other screens: this one filters as
        you type. A button that repeats what already happened teaches people
        their typing did not count. The clear cross is the half that was
        missing.

        The one control allowed to grow, because it is the one whose content
        has no length limit. The minimum is the width below which the row gives
        up and wraps, not the width it usually gets.

        The placeholder is one word because on the narrowest laptop it has
        eighty pixels to say it in, and a hint reading "Search descri" looks
        like a fault rather than an invitation. What the search covers —
        description, reference, ref no. — is learnt by typing; the magnifier
        and the label carry the rest.
      */}
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Search"
        label="Search the transactions"
        className="min-w-32 flex-1"
      />

      {/*
        The two dates are one bordered control, not two. The rule between them
        is what says they are the ends of a range, and the single border and
        padding are worth about thirty pixels to the search box.

        Their labels moved onto the inputs themselves. Captions stacked above
        are what made this two rows in the first place, and a date input ignores
        a placeholder — so `aria-label` names each end for a screen reader and
        `title` says the same thing to a mouse.

        A date field sizes itself: the browser asks for whatever "mm/dd/yyyy"
        and the picker button need, and no width of ours can make it smaller
        without cutting the year off. What it does answer to is type size, and
        at 13px the pair asks for 234px against 266px at the app's usual 15px.
        That difference is the whole reason this row fits a laptop, and digits
        in a mono face carry the smaller size without complaint.

        It also answers to the screen: the same pair measures 261px at 1×, 273px
        at 2× and 285px at 3×, Chrome rounding the fields it draws inside up to
        whole device pixels. The search box absorbs all of that, which is why
        its minimum is set low enough to survive the widest of them.
      */}
      <div className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-muted px-2 text-xs transition focus-within:border-primary focus-within:bg-surface">
        <input
          type="date"
          aria-label="From date"
          title="From date"
          value={filters.from ?? ""}
          onChange={(event) => set({ from: event.target.value || undefined })}
          className="num w-auto bg-transparent outline-none"
        />
        <span aria-hidden="true" className="h-5 w-px bg-border" />
        <input
          type="date"
          aria-label="To date"
          title="To date"
          value={filters.to ?? ""}
          onChange={(event) => set({ to: event.target.value || undefined })}
          className="num w-auto bg-transparent outline-none"
        />
      </div>

      {/* Content-sized is safe here and only here: the three options are
          written below, so the widest one is known. */}
      <select
        aria-label="Direction"
        value={filters.direction ?? ""}
        onChange={(event) =>
          set({
            direction: (event.target.value || undefined) as
              TxnDirection | undefined,
          })
        }
        className={cn(controlClass, "w-auto shrink-0")}
      >
        <option value="">In and out</option>
        <option value="in">Money in</option>
        <option value="out">Money out</option>
      </select>

      {accounts.length > 1 ? (
        // Capped, unlike the direction select: an account named after its bank
        // and its branch number would otherwise size this to itself and take
        // the room out of the search box. The cap is 136px rather than a
        // rounder 128 because "All accounts" needs 129 of them, and that is
        // what this reads for as long as nobody has chosen one; past the cap
        // the browser ellipsises the name, which is the right thing to lose.
        <select
          aria-label="Account"
          value={filters.accountId ?? ""}
          onChange={(event) =>
            set({ accountId: event.target.value || undefined })
          }
          className={cn(controlClass, "w-auto max-w-34 shrink-0")}
        >
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      ) : null}

      {/*
        Searchable, because this is the longest list on the screen and the one
        people come to the ledger to use. Scrolling a grouped list to find
        "Courier and postage" is the whole reason the filter gets ignored — and
        on one line there is even less room to read it in, so typing matters
        more here than it did when this had a row to itself.

        "All categories" is an option rather than a cleared value, so undoing
        the filter is in the same place as setting it — and the width is the
        one that shows those two words whole, since that is what the control
        says for as long as nobody has touched it.
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
    </div>
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
