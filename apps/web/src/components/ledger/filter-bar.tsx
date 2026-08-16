"use client";

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type TxnDirection,
} from "@finance/shared";
import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";

export type LedgerFilters = {
  from?: string;
  to?: string;
  accountId?: string;
  direction?: TxnDirection;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  q?: string;
  includeVoided?: boolean;
};

export function FilterBar({
  filters,
  accounts,
  categories,
  onChange,
  showDirection = true,
  showAccount = true,
}: {
  filters: LedgerFilters;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onChange: (next: LedgerFilters) => void;
  showDirection?: boolean;
  showAccount?: boolean;
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="relative flex min-w-52 flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <span className="sr-only">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search description, reference, or ref no."
            className={cn(controlClass, "pl-9")}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="date"
            value={filters.from ?? ""}
            onChange={(event) => set({ from: event.target.value || undefined })}
            className={cn(controlClass, "num w-40")}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input
            type="date"
            value={filters.to ?? ""}
            onChange={(event) => set({ to: event.target.value || undefined })}
            className={cn(controlClass, "num w-40")}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showDirection ? (
          <select
            value={filters.direction ?? ""}
            onChange={(event) =>
              set({ direction: (event.target.value || undefined) as TxnDirection })
            }
            className={cn(controlClass, "h-9 w-auto")}
          >
            <option value="">In and out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
        ) : null}

        {showAccount && accounts.length > 1 ? (
          <select
            value={filters.accountId ?? ""}
            onChange={(event) =>
              set({ accountId: event.target.value || undefined })
            }
            className={cn(controlClass, "h-9 w-auto")}
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
          Searchable, because this is the longest list on the screen and the
          one people come to the ledger to use. Scrolling a grouped list to
          find "Courier and postage" is the whole reason the filter gets
          ignored.

          "All categories" is an option rather than a cleared value, so
          undoing the filter is in the same place as setting it.
        */}
        <SearchableSelect
          className="w-56"
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

        <select
          value={filters.paymentMethod ?? ""}
          onChange={(event) =>
            set({
              paymentMethod: (event.target.value || undefined) as
                | PaymentMethod
                | undefined,
            })
          }
          className={cn(controlClass, "h-9 w-auto")}
        >
          <option value="">Any method</option>
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={filters.includeVoided ?? false}
            onChange={(event) => set({ includeVoided: event.target.checked })}
            className="size-4 accent-primary"
          />
          Show voided
        </label>

        {active > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onChange({})}>
            <X className="size-3.5" />
            Clear {active}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
