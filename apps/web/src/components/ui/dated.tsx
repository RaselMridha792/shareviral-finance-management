import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import type { ReactNode } from "react";

/**
 * A date in a table row, as the September 2026 handoff draws every one: a
 * violet calendar before it, on one line.
 *
 * Its own piece rather than a class, because the icon is an SVG and every
 * table that shows a date wants the same one at the same size.
 */
export function Dated({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px] whitespace-nowrap tabular-nums">
      <CalendarBlankIcon
        weight="duotone"
        size={16}
        className="flex-none text-(--sv-violet)"
      />
      {children}
    </span>
  );
}
