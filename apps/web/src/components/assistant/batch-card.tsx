"use client";

import { AI_TARGET_LABELS, type AiBatch } from "@finance/shared";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";

import { labelFor } from "@/components/assistant/draft-card";
import { Button } from "@/components/ui/button";

export type RowResult = { ok: true; refNo?: string } | { ok: false; error: string };

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
 */
export function BatchCard({
  batch,
  results,
  saving,
  savedCount,
  dropped,
  onDrop,
  onConfirm,
}: {
  batch: AiBatch;
  /** Per-row outcome, once Save has been pressed. */
  results: RowResult[] | null;
  saving: boolean;
  savedCount: number;
  dropped: Set<number>;
  onDrop: (index: number) => void;
  onConfirm: () => void;
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

  const keeping = batch.rows.length - dropped.size;
  const failed = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">
            {batch.note ?? `${batch.rows.length} to add`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {AI_TARGET_LABELS[batch.target]} ·{" "}
            <span className="num">{keeping}</span> of{" "}
            <span className="num">{batch.rows.length}</span> will be saved
            {results ? null : " · nothing is written until you press Save"}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="w-10 px-3 py-2" />
              {columns.map((key) => (
                <th
                  key={key}
                  className="px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground"
                >
                  {labelFor(key)}
                </th>
              ))}
              {results ? (
                <th className="px-3 py-2 text-xs font-medium text-muted-foreground">
                  Result
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {batch.rows.map((row, index) => {
              const isDropped = dropped.has(index);
              const result = results?.[index];

              return (
                <tr
                  key={index}
                  className={
                    isDropped
                      ? "row-finance text-muted-foreground line-through opacity-55"
                      : "row-finance"
                  }
                >
                  <td className="px-3 py-2 align-top">
                    {results ? (
                      <span className="num text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onDrop(index)}
                        aria-label={
                          isDropped ? "Put this one back" : "Leave this one out"
                        }
                        className="cursor-pointer rounded p-1 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </td>

                  {columns.map((key) => (
                    <td
                      key={key}
                      className="max-w-56 truncate px-3 py-2 align-top"
                      title={String(row[key] ?? "")}
                    >
                      {row[key] === undefined || row[key] === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        String(row[key])
                      )}
                    </td>
                  ))}

                  {results ? (
                    <td className="px-3 py-2 align-top">
                      {!result ? (
                        <span className="text-muted-foreground">—</span>
                      ) : result.ok ? (
                        <span className="inline-flex items-center gap-1.5 text-positive">
                          <CircleCheck className="size-3.5" />
                          {result.refNo ?? "Saved"}
                        </span>
                      ) : (
                        <span className="inline-flex items-start gap-1.5 text-negative">
                          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                          <span>{result.error}</span>
                        </span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
        {results ? (
          <p className="text-sm">
            <span className="num font-medium">
              {results.filter((r) => r.ok).length}
            </span>{" "}
            saved
            {failed ? (
              <>
                ,{" "}
                <span className="num font-medium text-negative">{failed}</span>{" "}
                refused — those are on the rows above, and the ordinary form
                takes them.
              </>
            ) : (
              "."
            )}
          </p>
        ) : (
          <>
            <Button type="button" onClick={onConfirm} disabled={saving || !keeping}>
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {saving
                ? `Saving ${savedCount} of ${keeping}…`
                : `Save ${keeping}`}
            </Button>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Each one is saved the same way the form saves it, with its own
              entry in the audit log.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
