import type { ReactNode } from "react";

import { Glyph, type GlyphSource } from "@/components/ui/glyph";

/**
 * The card every screen opens with, as the September 2026 handoff draws it.
 *
 * A white card with a masked lime grid drifting in from the right, a lime blob,
 * a dashed violet ring and a small violet square behind the words; a 56px lime
 * tile holding the screen's icon, filled; the title at 28px/800 with its line
 * under it; the screen's own controls at the right-hand end.
 *
 * The owner saw the twenty-one screens this reaches before it changed, and
 * chose all of them at once over one screen at a time.
 *
 * The icon may still arrive as a Material name, which is what most callers
 * pass — `Glyph` turns it into the handoff's Phosphor icon.
 */
export function PageHeader({
  title,
  eyebrow,
  icon,
  description,
  actions,
}: {
  title: string;
  /** A small violet line over the title — Settings' "Settings · General". */
  eyebrow?: ReactNode;
  /**
   * The screen's icon: a Phosphor component, or the Material name the rail used
   * to carry (see `glyph.tsx`).
   */
  icon?: GlyphSource;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sv-page-head sv-rise relative isolate flex flex-wrap items-center gap-4 overflow-hidden rounded-[11px] bg-(--sv-surface) px-6 py-5.5">
      <div aria-hidden="true" className="sv-page-head-decor">
        <span className="grid-paper" />
        <span className="blob" />
        <span className="loop" />
        <span className="square" />
      </div>

      <div className="flex min-w-65 flex-1 items-center gap-3.5">
        {icon ? (
          <span className="sv-page-head-tile grid size-14 flex-none place-items-center rounded-[14px] bg-(--sv-accent) text-(--sv-on-accent)">
            <Glyph icon={icon} weight="fill" size={27} />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-0.5 text-[11px] font-extrabold tracking-[0.14em] text-(--sv-violet-ink) uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 text-[14.5px] text-(--sv-muted)">
              {description}
            </p>
          ) : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
