"use client";

import {
  AI_TARGET_LABELS,
  formatMoney,
  fromMinorUnits,
  normaliseAmount,
  toMinorUnits,
  type AiBatch,
  type AiTarget,
} from "@finance/shared";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import { Fragment } from "react";

import { labelFor } from "@/components/assistant/draft-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RowResult =
  { ok: true; refNo: string | null } | { ok: false; error: string };

/** The kinds of record a table can hold whose rows are money, in taka. */
const MONEY: readonly AiTarget[] = [
  "transaction_out",
  "transaction_in",
  "transfer",
  "tds_deposit",
];

/**
 * How many rows, and what they come to: the summary read before anything is
 * confirmed (A4).
 *
 * Added in paisa, never in floats. A row whose amount cannot be read — blank,
 * or written with a dollar sign in a taka column — is counted apart and left
 * out of the total, so the total never quietly includes a guess.
 */
function summaryOf(
  target: AiTarget,
  rows: Array<Record<string, unknown>>,
): { count: number; total: string | null; unreadable: number } {
  if (!MONEY.includes(target)) {
    return { count: rows.length, total: null, unreadable: 0 };
  }
  let paisa = BigInt(0);
  let unreadable = 0;
  for (const row of rows) {
    const raw = row.amount;
    const written = typeof raw === "number" ? String(raw) : raw;
    if (typeof written !== "string" || !written.trim() || /\$/.test(written)) {
      unreadable += 1;
      continue;
    }
    try {
      paisa += toMinorUnits(normaliseAmount(written));
    } catch {
      unreadable += 1;
    }
  }
  return {
    count: rows.length,
    total: formatMoney(fromMinorUnits(paisa)),
    unreadable,
  };
}

/**
 * Many proposed records, as a table you read before any of them is written.
 *
 * The single draft is a form, because one record deserves one field per line.
 * Seventeen records do not: a stack of seventeen forms is something nobody
 * reads to the bottom, which is the same as not showing it. A table is read
 * down a column, and a column is where a repeated mistake shows up — one wrong
 * joining date is a typo, seventeen identical ones is a misread column, and
 * only the table makes the difference obvious at a glance.
 *
 * Rows are dropped here rather than edited. Correcting sixteen cells in a chat
 * message is worse than saving what is right and fixing the rest on the form
 * that was built for it; dropping a row is the one action that is genuinely
 * cheaper here than anywhere else.
 *
 * Confirmed one by one, or all together under the count and the total (A4).
 * Either way each row is checked again on the server and saved the way its
 * form saves it, and a row once saved is never offered again.
 */
export function BatchCard({
  batch,
  results,
  saving,
  savingRow,
  savedCount,
  dropped,
  onDrop,
  onConfirmRow,
  onConfirmAll,
}: {
  batch: AiBatch;
  /** Each row's outcome so far: saved, here or before, or refused. */
  results: Record<number, RowResult>;
  /** Confirm and save all is running. */
  saving: boolean;
  /** The one row being saved on its own, if any. */
  savingRow: number | null;
  savedCount: number;
  dropped: Set<number>;
  onDrop: (index: number) => void;
  onConfirmRow: (index: number) => void;
  onConfirmAll: () => void;
}) {
  /**
   * The columns to show, in the order the rows actually use them.
   *
   * Taken from the rows rather than from a fixed list: the fields present
   * depend on what was in the file, and a column of nothing but dashes tells
   * the reader less than no column at all.
   */
  const columns: string[] = [];
  for (const row of batch.rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  const isSaved = (index: number) => results[index]?.ok === true;
  const waiting = batch.rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => !dropped.has(index) && !isSaved(index));
  const summary = summaryOf(
    batch.target,
    waiting.map(({ row }) => row),
  );
  const saved = Object.values(results).filter((r) => r.ok).length;
  const refused = Object.values(results).filter((r) => !r.ok).length;
  const busy = saving || savingRow !== null;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            {batch.note ?? `${batch.rows.length} to add`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {AI_TARGET_LABELS[batch.target]}
            {saved ? (
              <>
                {" "}
                · <span className="num">{saved}</span> saved
              </>
            ) : null}
            {" · nothing else is written until you confirm"}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="w-10 px-3 py-2" />
              {/* On the left, where it is seen without scrolling sideways:
                  a wide file pushes its last columns out of view. */}
              <th className="px-3 py-2 text-xs font-medium text-muted-foreground">
                Saved
              </th>
              {columns.map((key) => (
                <th
                  key={key}
                  className="px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground"
                >
                  {labelFor(key, batch.target)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row, index) => {
              const isDropped = dropped.has(index);
              const result = results[index];
              const done = result?.ok === true;
              const refusal = result && !result.ok ? result.error : null;

              return (
                <Fragment key={index}>
                  <tr
                    className={cn(
                      "row-finance",
                      isDropped &&
                        "text-muted-foreground line-through opacity-55",
                    )}
                  >
                    <td className="px-3 py-2 align-middle">
                      {done ? (
                        <span className="num text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onDrop(index)}
                          disabled={busy}
                          aria-label={
                            isDropped
                              ? "Put this one back"
                              : "Leave this one out"
                          }
                          className="cursor-pointer rounded p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </td>

                    <td className="px-3 py-2 align-middle whitespace-nowrap">
                      {done ? (
                        <span className="inline-flex items-center gap-1.5 text-positive">
                          <CircleCheck className="size-3.5" />
                          <span className="num">{result.refNo ?? "Saved"}</span>
                        </span>
                      ) : isDropped ? (
                        <span className="text-muted-foreground">Left out</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => onConfirmRow(index)}
                          disabled={busy}
                          aria-label={`Confirm and save row ${index + 1}`}
                        >
                          {savingRow === index ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : null}
                          Confirm
                        </Button>
                      )}
                    </td>

                    {columns.map((key) => (
                      <td
                        key={key}
                        className="max-w-56 truncate px-3 py-2 align-middle"
                        title={String(row[key] ?? "")}
                      >
                        {row[key] === undefined || row[key] === null ? (
                          <span className="text-muted-foreground">N/A</span>
                        ) : (
                          String(row[key])
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Why it was refused, on a line of its own under the row,
                      held in view at the left while the table scrolls. */}
                  {refusal && !isDropped ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="px-3 pb-3">
                        <p className="sticky left-3 inline-flex w-[min(40rem,calc(100vw-5rem))] items-start gap-1.5 text-[13px] leading-snug text-negative">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>{refusal}</span>
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
        {/* The summary the person checks against the file, before the
            button that saves all of it. */}
        {summary.count ? (
          <p className="text-sm">
            <span className="num font-semibold">{summary.count}</span> to
            save
            {summary.total !== null ? (
              <>
                {" "}
                · total{" "}
                <span className="num font-semibold">{summary.total}</span>
              </>
            ) : null}
            {summary.unreadable ? (
              <span className="text-negative">
                {" "}
                · <span className="num">{summary.unreadable}</span> with no
                amount that can be read, left out of the total
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-sm">
            <span className="num font-medium">{saved}</span> saved
            {refused ? null : "."}
          </p>
        )}

        {refused ? (
          <p className="text-xs text-negative">
            <span className="num">{refused}</span> refused — why is on each
            row. Fix what it says and confirm it again, or use the ordinary
            form.
          </p>
        ) : null}

        {summary.count ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="primary"
              onClick={onConfirmAll}
              disabled={busy}
            >
              {saving ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {saving
                ? `Saving ${savedCount} of ${summary.count}…`
                : `Confirm and save all ${summary.count}`}
            </Button>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Each one is checked again and saved the way its form saves it,
              with its own entry in the audit log.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
