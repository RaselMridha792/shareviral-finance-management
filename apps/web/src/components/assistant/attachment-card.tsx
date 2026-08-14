"use client";

import type { AiAttachment, AiImportPlan } from "@finance/shared";
import {
  ArrowRight,
  FileSpreadsheet,
  LoaderCircle,
  TableProperties,
  X,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The file, as the app read it.
 *
 * Shown before anything is asked about it, because the first thing to check is
 * whether the columns were understood at all — a statement whose amount column
 * was read as text produces confident answers that are all wrong, and the only
 * moment that is cheap to catch is here.
 *
 * The totals are the server's arithmetic, not the model's.
 */
export function AttachmentCard({
  attachment,
  plan,
  staging,
  onSendToImport,
  onRemove,
}: {
  attachment: AiAttachment;
  /** Where the assistant worked out these rows should go, if it got that far. */
  plan?: AiImportPlan | null;
  staging: boolean;
  onSendToImport: () => void;
  onRemove?: () => void;
}) {
  const truncated = attachment.storedRows < attachment.rowCount;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <FileSpreadsheet className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">
            {attachment.name}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="num">{attachment.rowCount}</span> rows ·{" "}
            <span className="num">{attachment.columns.length}</span> columns
            {truncated ? (
              <>
                {" "}
                · only the first{" "}
                <span className="num">{attachment.storedRows}</span> are
                readable
              </>
            ) : null}
          </p>
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this file"
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {attachment.columns.map((column) => (
            <span
              key={column.name}
              title={
                column.total !== undefined
                  ? `Totals ${column.total}, from ${column.min} to ${column.max}`
                  : column.kind === "date"
                    ? `${column.min} to ${column.max}`
                    : column.distinct !== undefined
                      ? `${column.distinct} distinct values`
                      : column.examples.join(" | ")
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs"
            >
              <span className="font-medium">{column.name}</span>
              <span className="text-muted-foreground">
                {column.total !== undefined ? (
                  <span className="num">{column.total}</span>
                ) : column.kind === "date" ? (
                  "dates"
                ) : (
                  `${column.filled}`
                )}
              </span>
            </span>
          ))}
        </div>

        {attachment.importBatchId ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted px-3 py-2.5">
            <p className="text-sm text-muted-foreground">
              These rows are waiting on the import screen.
            </p>
            <Link
              href={`/import?batch=${attachment.importBatchId}`}
              className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Open Import
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* What it worked out from the conversation, shown before the
                button rather than after — this is the last point at which
                "wrong account" is one word to say instead of a revert. */}
            {plan ? (
              <div className="rounded-lg bg-surface-muted px-3 py-2.5 text-sm">
                <p className="font-medium">
                  {plan.note ?? "Ready to stage these rows."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Into <span className="font-medium">{plan.accountName}</span>
                  {plan.categoryName ? (
                    <>
                      , filed as{" "}
                      <span className="font-medium">{plan.categoryName}</span>
                    </>
                  ) : null}
                  . You will see every row before anything is written.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={staging}
                onClick={onSendToImport}
              >
                {staging ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <TableProperties className="size-3.5" />
                )}
                Send to Import
              </Button>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {plan
                  ? "Check every row, then import. The whole batch can be undone afterwards."
                  : "Map the columns, see every row before it is written, and undo the whole batch afterwards."}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
