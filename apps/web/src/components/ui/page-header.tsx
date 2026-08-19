import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";

/**
 * The title block every screen opens with.
 *
 * The glyph is the same one the rail uses for this screen, at 27px and three
 * quarters opacity. That repetition is the point: the eye that found Payroll
 * by its green banknote in the rail lands on the same banknote at the top of
 * the page, and knows without reading that the click did what it meant to.
 * Plain rather than hued here — in the rail the colour distinguishes fifteen
 * items from each other, and on a page where it is the only icon there is
 * nothing to distinguish it from.
 */
export function PageHeader({
  title,
  icon,
  description,
  actions,
}: {
  title: string;
  /** A Material Symbols Rounded ligature — the rail's icon for this screen. */
  icon?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex flex-col gap-[7px]">
        <h1 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.02em]">
          {icon ? <Icon name={icon} size={27} className="opacity-75" /> : null}
          {title}
        </h1>
        {description ? (
          <p className="text-[15px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
