import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The pieces every data table in this app is built from.
 *
 * There were thirteen local `Th` helpers before this, one per screen, each
 * re-declaring `px-4 py-2.5 text-xs font-semibold tracking-wide uppercase` —
 * every word of which `.table-data thead th` in globals.css already sets, at a
 * higher specificity. So thirteen copies of a class list that did nothing, and
 * a `text-right` among them that actively failed for the same reason.
 *
 * Styling belongs in the stylesheet. What belongs here is the width, the
 * alignment, and the fact that a heading is a heading.
 */

export function Th({
  children,
  align = "left",
  width,
  className,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  /** A Tailwind width class — "w-24". Column widths are per-table. */
  width?: string;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        align === "right" && "text-right",
        align === "center" && "text-center",
        width,
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * The serial cell. Narrow, greyed, and not the point of the row.
 *
 * It is first in every table by the owner's rule, and it should read as a
 * position rather than as data — the eye should skip it on the way to the date.
 */
export function SerialCell({ n }: { n: number }) {
  return <td className="num text-xs text-faint">{n}</td>;
}

/** The SL heading, so no table has to remember how wide it is. */
export function SerialHead() {
  return <Th width="w-12">SL</Th>;
}

/**
 * A table that scrolls sideways inside its own card.
 *
 * The rule worth keeping: a wide table that makes the *page* scroll takes the
 * rail and the heading with it. Scrolling within the card leaves the rest of
 * the screen where it was.
 */
export function TableScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("table-scroll overflow-x-auto", className)}>
      {children}
    </div>
  );
}

/**
 * One row saying why there are no rows.
 *
 * Inside the table, spanning it — so the headings stay, the card keeps its
 * shape, and the pager underneath survives. Nine screens in this app currently
 * swap the entire table out for a card instead, which is what makes a pager
 * vanish on the page you need it.
 *
 * `tone="error"` matters more than it looks: a request that failed and a set
 * that is genuinely empty are different facts, and a screen that reports the
 * first as the second states something confident and wrong about the books.
 */
export function TableMessageRow({
  colSpan,
  tone = "muted",
  children,
}: {
  colSpan: number;
  tone?: "muted" | "error";
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          "px-6 py-10 text-center text-sm",
          tone === "error" ? "text-negative" : "text-muted-foreground",
        )}
      >
        {children}
      </td>
    </tr>
  );
}
