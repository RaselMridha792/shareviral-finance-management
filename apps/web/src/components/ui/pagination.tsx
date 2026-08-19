"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Where you are in the rows, and how to get to the rest.
 *
 * Written twice before this, differently — "Previous / Next" with a sentence on
 * one screen, "Back / 3 / 7" with a chip on another — and neither knew about
 * the other. One control now, so the twelve tables that are about to grow one
 * cannot arrive at twelve.
 *
 * **Render it as a sibling of the table, never inside the loading-or-empty
 * ternary.** Nine screens in this app replace the whole table with a card when
 * they have no rows; a pager written inside that branch disappears on an empty
 * page, which is precisely the page somebody needs it on to get back.
 */
export function Pagination({
  page,
  totalPages,
  total,
  noun = "entry",
  nounPlural,
  onPage,
  className,
}: {
  /** 1-based. */
  page: number;
  totalPages: number;
  /** The whole set, not the visible page — it is what the sentence counts. */
  total: number;
  /** "entry", "record", "plan" — whatever these rows are. */
  noun?: string;
  nounPlural?: string;
  onPage: (next: number) => void;
  className?: string;
}) {
  // One page is not worth a control, but the count is still worth saying.
  const plural = nounPlural ?? `${noun}s`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-sm",
        className,
      )}
    >
      <span className="text-muted-foreground">
        {totalPages > 1 ? (
          <>
            Page <span className="num">{page}</span> of{" "}
            <span className="num">{totalPages}</span> ·{" "}
          </>
        ) : null}
        <span className="num">{total}</span> {total === 1 ? noun : plural}
      </span>

      {totalPages > 1 ? (
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </span>
      ) : null}
    </div>
  );
}
