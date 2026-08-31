"use client";

import { LoaderCircle, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@finance/shared";

/**
 * What is ticked, and the one thing that can be done with it.
 *
 * It appears only when something is ticked, above the table it belongs to, so
 * a table nobody is selecting on looks exactly as it did.
 *
 * The sentence is the point. `payroll/member-picker.tsx` already writes the
 * one this app uses — a count, then the money — and it is written the same way
 * here because "3 items" is not a sentence anybody can check before agreeing
 * to it. On tables whose rows are not money (people, sign-ins, exchange
 * rates) the money half is simply left out rather than shown as ৳0.00, which
 * would be a figure rather than an absence.
 */
export function BulkBar({
  count,
  total,
  noun,
  pending,
  onClear,
  onTrash,
}: {
  count: number;
  /** Summed amount of the ticked rows, or null when the rows are not money. */
  total?: string | null;
  /** Singular; pluralised here so no caller has to. */
  noun: string;
  pending?: boolean;
  onClear: () => void;
  onTrash: () => void;
}) {
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2"
    >
      <p className="text-sm text-muted-foreground">
        <span className="num font-medium text-foreground">{count}</span>{" "}
        {count === 1 ? noun : `${noun}s`} selected
        {total != null ? (
          <>
            {" · "}
            <span className="num font-medium text-foreground">
              {formatMoney(total)}
            </span>
          </>
        ) : null}
      </p>

      <span className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={pending}
        >
          <X className="size-3.5" />
          Clear
        </Button>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onTrash}
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          Move to trash
        </Button>
      </span>
    </div>
  );
}
