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

/**
 * The tick that puts a row in the selection.
 *
 * A `<td className="tick">` rather than a styled checkbox, because the class is
 * load-bearing: `globals.css` uses `.table-data .tick + *` to suppress the
 * vertical rule that SL would otherwise grow the moment anything sits to its
 * left. Every table without a tick column renders byte-identically.
 *
 * The whole cell is the target, not just the 14px box. Ticking forty rows with
 * a mouse is the act being made cheaper here; a small target undoes the point.
 */
export function TickCell({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  /** What is being ticked, for somebody who cannot see the row. */
  label: string;
}) {
  return (
    <td className="tick w-9">
      <label className="flex cursor-pointer items-center justify-center py-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          aria-label={`Select ${label}`}
          className="size-3.5 cursor-pointer accent-primary"
        />
      </label>
    </td>
  );
}

/**
 * The header tick: every row on THIS page.
 *
 * Not "everything matching the filter" — see `use-bulk-select.tsx` for why that
 * is not buildable on eight of the nine tables and would make one control mean
 * two different things. The label says which, so nobody has to guess.
 */
export function TickHead({
  state,
  onChange,
}: {
  state: "none" | "some" | "all";
  onChange: () => void;
}) {
  return (
    <th className="tick w-9">
      <label className="flex cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={state === "all"}
          /*
           * `indeterminate` is a DOM property, not an attribute — React will
           * not set it from JSX, so it goes on through the ref. Nothing else in
           * this app uses one, which is why it is worth saying out loud.
           */
          ref={(el) => {
            if (el) el.indeterminate = state === "some";
          }}
          onChange={onChange}
          aria-label="Select every row on this page"
          className="size-3.5 cursor-pointer accent-primary"
        />
      </label>
    </th>
  );
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
  /*
   * `relative` is not decoration.
   *
   * A statically-positioned `overflow-x: auto` box does not contain its own
   * scrollable overflow as far as the document is concerned: the profile's
   * sixteen-column tools table scrolled inside its box exactly as intended,
   * and still added a thousand pixels to `documentElement.scrollWidth`, so the
   * whole page slid sideways under a table that was already scrolling.
   *
   * Giving the scroller a position stops it. The tables that never showed this
   * were the ones inside a card with `overflow-hidden`, which was clipping the
   * leak by accident rather than by design — so this belongs here, once, where
   * every table gets it.
   */
  return (
    <div className={cn("relative overflow-x-auto", className)}>{children}</div>
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
        // `table-message` is what carries the height — see globals.css. The
        // padding cannot live here: `.table-data tbody td` outranks a utility.
        className={cn(
          "table-message text-center text-sm",
          tone === "error" ? "text-negative" : "text-muted-foreground",
        )}
      >
        {children}
      </td>
    </tr>
  );
}
