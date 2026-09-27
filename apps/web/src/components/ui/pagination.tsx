"use client";

import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";

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
  /*
   * One page, no control.
   *
   * The owner's rule: pagination appears when a table has more than a page of
   * rows, and not before. A "Page 1 of 1" under five users is a control that
   * cannot do anything, and the row count is already in the card's own heading
   * on nearly every screen — so this would be saying it twice to announce that
   * there is nothing to page through.
   */
  if (totalPages <= 1) return null;

  const plural = nounPlural ?? `${noun}s`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 text-[13.5px]",
        className,
      )}
    >
      <span className="text-(--sv-muted)">
        Page{" "}
        <b className="font-extrabold text-(--sv-ink) tabular-nums">{page}</b> of{" "}
        <b className="font-extrabold text-(--sv-ink) tabular-nums">
          {totalPages}
        </b>{" "}
        · <b className="font-extrabold text-(--sv-ink) tabular-nums">{total}</b>{" "}
        {total === 1 ? noun : plural}
      </span>

      <span className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-[34px] px-3"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <CaretLeftIcon weight="bold" size={14} />
          Previous
        </Button>
        {/* Next is the lime one, as on the handoff's own pager: it is the
            way on, and Previous is the way back. */}
        <Button
          size="sm"
          variant="primary"
          className="h-[34px] px-3 shadow-none"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
          <CaretRightIcon weight="bold" size={14} />
        </Button>
      </span>
    </div>
  );
}
