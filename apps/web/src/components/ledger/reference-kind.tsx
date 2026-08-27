"use client";

import { Eye, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Two ways a payment can be pointed at, and the pair of controls that serve
 * them.
 *
 * The owner's observation: a bank does not always give a transaction id.
 * Sometimes all there is is the slip — a screenshot, a PDF, the paper itself.
 * The form used to insist on a box for a number that often did not exist, and
 * the table then drew a dash over a row that *did* have its paperwork
 * attached, with no way to reach it.
 *
 * So the entry chooses: a **transaction id** (the number, with its paper on
 * the clip beside it — unchanged) or **reference only** (no number, just the
 * paper). Nothing is stored to say which was chosen, and that is deliberate:
 * a row with a number is the first case and a row without one is the second,
 * so the two can never drift apart, and every entry made before today reads
 * correctly under the new rule.
 *
 * The table then says the same thing in one cell: the number when there is
 * one, an eye when there is only paper, a dash when there is neither.
 */

export type ReferenceKind = "id" | "paper";

/** The choice, above the field it governs. */
export function ReferenceKindToggle({
  value,
  onChange,
  idLabel = "Transaction ID",
}: {
  value: ReferenceKind;
  onChange: (next: ReferenceKind) => void;
  /** What the numbered option is called on this form. */
  idLabel?: string;
}) {
  return (
    <span className="mb-1.5 flex w-fit gap-0.5 rounded-lg bg-surface-muted p-0.5 text-xs">
      {(
        [
          ["id", idLabel],
          ["paper", "Reference only"],
        ] as const
      ).map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
          className={cn(
            "cursor-pointer rounded-md px-2 py-1 font-medium transition",
            value === kind
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

/**
 * The number, or the eye, or a dash — the table half of the same idea.
 *
 * Three states rather than two, and the middle one is the point: a row with
 * paperwork and no number used to render as a dash, which said "nothing here"
 * about an entry whose bank slip was sitting one click away.
 *
 * The warning triangle keeps its old job on a numbered cell: a reference
 * somebody typed with nothing attached is the row to chase.
 */
export function ReferenceCell({
  value,
  documentCount,
  onOpen,
}: {
  value: string | null;
  documentCount: number;
  onOpen: () => void;
}) {
  if (!value && documentCount === 0) {
    return <td className="text-muted-foreground">N/A</td>;
  }

  if (!value) {
    return (
      <td>
        <button
          type="button"
          onClick={onOpen}
          title={`${documentCount} attached — no transaction id was given`}
          aria-label="Show the attached record"
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-link transition hover:bg-surface-muted"
        >
          <Eye className="size-3.5" />
          <span className="text-xs">view</span>
        </button>
      </td>
    );
  }

  return (
    <td>
      <button
        type="button"
        onClick={onOpen}
        title={
          documentCount > 0
            ? `${documentCount} attached`
            : "Nothing attached to this entry"
        }
        className="num inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-link underline decoration-link/40 underline-offset-2 transition hover:decoration-link"
      >
        {documentCount === 0 ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : null}
        {value}
      </button>
    </td>
  );
}

/**
 * The field body a form renders under the toggle: the input when a number is
 * being typed, nothing when only the paper is. The paperclip is the caller's
 * — every form wraps its own — so this decides only whether the box appears.
 */
export function ReferenceInput({
  kind,
  children,
}: {
  kind: ReferenceKind;
  children: ReactNode;
}) {
  return kind === "id" ? <>{children}</> : null;
}
