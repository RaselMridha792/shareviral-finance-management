import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The dashboard's figure card and its section heading, as the September 2026
 * handoff draws them.
 *
 * Here rather than in `components/ui/`: this is the first screen rebuilt, and a
 * card that twenty screens import is a decision for when a second screen wants
 * the same one — asked about then, not assumed now. The Expense overview
 * screen still draws the older strip from `ui/patterns`, which is untouched.
 */

/** What the figure means, which decides the tile's tint and the figure's ink. */
export type FigureTone = "neutral" | "in" | "out";

const TILE: Record<FigureTone, string> = {
  neutral: "bg-(--sv-violet-tint) text-(--sv-violet)",
  in: "bg-(--sv-pos-tint) text-(--sv-pos)",
  out: "bg-(--sv-neg-tint) text-(--sv-neg)",
};

const INK: Record<FigureTone, string> = {
  neutral: "text-(--sv-ink)",
  in: "text-(--sv-pos)",
  out: "text-(--sv-neg)",
};

/**
 * One figure: a tinted icon tile and its label, the figure large, the same
 * figure in the other currency small under it, and a note beneath a hairline.
 *
 * Money in is green and money out is red, whatever the brand is doing — the
 * tile and the figure both — and everything else is the violet of the rest of
 * the design.
 */
export function FigureCard({
  icon: Glyph,
  label,
  value,
  sub,
  note,
  tone = "neutral",
  href,
  className,
  style,
  children,
}: {
  icon: Icon;
  label: string;
  value: string;
  /** The same money in the other currency, marked ≈ where it is translated. */
  sub?: string | null;
  note?: ReactNode;
  tone?: FigureTone;
  /**
   * Where the figure comes from — the whole card becomes the way there. The
   * owner: "dashboard a nicer card gula jate clickable thake". Left off while
   * the cards are being arranged, when a click means something else, and
   * never given together with `children`: nothing clickable may sit inside a
   * link.
   */
  href?: string;
  className?: string;
  style?: CSSProperties;
  /** Laid over the card — the remove cross while the row is being arranged. */
  children?: ReactNode;
}) {
  const classes = cn(
    "sv-card sv-card-lift relative flex flex-col gap-1.5 rounded-[11px] bg-(--sv-surface) px-5 py-[18px]",
    href && "cursor-pointer",
    className,
  );
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 flex-none place-items-center rounded-[11px]",
            TILE[tone],
          )}
        >
          <Glyph weight="duotone" size={20} />
        </span>
        <span className="text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
          {label}
        </span>
      </div>

      <p
        className={cn(
          "mt-1.5 text-[27px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums",
          INK[tone],
        )}
      >
        {value}
      </p>

      {sub ? (
        <p className="text-[13px] text-(--sv-muted) tabular-nums">{sub}</p>
      ) : null}

      {note ? (
        <p className="sv-card-note mt-auto pt-2 text-[12.5px] text-(--sv-muted)">
          {note}
        </p>
      ) : null}

      {children}
    </>
  );

  return href ? (
    <Link href={href} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {body}
    </div>
  );
}

/**
 * The heading over a group of cards: a 40px tile, the name, a quiet line under
 * it, and anything that belongs at the right-hand end.
 *
 * Lime for an account — the brand's fill, the same tile the rail's mark sits
 * in — and violet for the spending, which is the one section that is not a
 * place money is kept.
 */
export function SectionHead({
  icon: Glyph,
  tile = "lime",
  title,
  subtitle,
  aside,
}: {
  icon: Icon;
  tile?: "lime" | "violet";
  title: string;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className={cn(
          "grid size-10 flex-none place-items-center rounded-[11px]",
          tile === "lime"
            ? "bg-(--sv-accent) text-(--sv-on-accent)"
            : "bg-(--sv-violet) text-white",
        )}
      >
        <Glyph weight="duotone" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[19px] font-extrabold tracking-[-0.01em]">
          {title}
        </h2>
        {subtitle ? (
          <p className="truncate text-[13px] text-(--sv-muted)">{subtitle}</p>
        ) : null}
      </div>
      {aside}
    </div>
  );
}

/** The grid the cards sit in: as many 230px columns as fit, 14px apart. */
export const FIGURE_GRID =
  "grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]";
