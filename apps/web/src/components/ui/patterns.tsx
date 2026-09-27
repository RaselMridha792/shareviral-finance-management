import type { ReactNode } from "react";

import { Glyph, type GlyphSource } from "@/components/ui/glyph";
import { cn } from "@/lib/utils";

/**
 * The structural patterns every screen is built from.
 *
 * They live together and are used rather than re-invented per page, which is
 * the whole point: eighteen screens that each drew their own "four figures in a
 * row" is eighteen slightly different rows, and the difference is always
 * visible and never intended.
 *
 * Drawn to the September 2026 handoff: white cards on 11px corners, each icon
 * in a tile tinted from its own colour (`.sv-tint-tile`), labels at 11px/800
 * in capitals, figures at 800.
 *
 * `icon` takes a Phosphor component or the Material name screens have always
 * passed (`glyph.tsx` maps it). `iconTone` is a text-colour class — the tile
 * behind the icon takes its tint from it.
 */

/** The tinted tile a figure's icon sits in. */
function ToneTile({
  icon,
  iconTone,
  size,
  glyph,
}: {
  icon: GlyphSource;
  iconTone?: string;
  /** Tailwind size class for the tile. */
  size: string;
  glyph: number;
}) {
  return (
    <span
      className={cn(
        "sv-tint-tile grid flex-none place-items-center rounded-[11px]",
        size,
        iconTone ?? "text-(--sv-violet)",
      )}
    >
      <Glyph icon={icon} size={glyph} />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat strip                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Several figures side by side, each its own card.
 *
 * The handoff's stat cards: a grid of white cards 14px apart, wrapping at
 * `min`. They used to be cells of one ruled panel; separate cards wrap without
 * the empty-cell problem that panel had to be careful about, since the space
 * at the end of a short row is simply the page.
 */
export function StatStrip({
  children,
  min = 244,
  className,
}: {
  children: ReactNode;
  /** Narrowest a card may get before the grid wraps. */
  min?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-3.5", className)}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export type StatTone = "default" | "positive" | "negative";

export function StatCell({
  label,
  icon,
  iconTone,
  value,
  tone = "default",
  secondary,
  footnote,
  emphasis = false,
  children,
}: {
  label: string;
  /** Coloured by meaning rather than decoration. */
  icon?: GlyphSource;
  iconTone?: string;
  value: ReactNode;
  /**
   * The figure's own colour. Money arriving is green and money leaving is red
   * — the same rule the ledger rows follow, so a card and a row never say
   * different things about the same direction.
   */
  tone?: StatTone;
  /** The "≈ $…" line under the figure. */
  secondary?: ReactNode;
  footnote?: ReactNode;
  /** The closing figure of a set sits on the lime tint, as "Total held" does. */
  emphasis?: boolean;
  children?: ReactNode;
}) {
  const tones: Record<StatTone, string> = {
    default: "text-(--sv-ink)",
    positive: "text-(--sv-pos)",
    negative: "text-(--sv-neg)",
  };

  return (
    <div
      className={cn(
        "sv-card sv-card-lift flex h-full flex-col gap-1.5 rounded-[11px] px-5 py-[18px]",
        emphasis ? "sv-card-lime bg-(--sv-lime-tint)" : "bg-(--sv-surface)",
      )}
    >
      <p className="flex items-center gap-2.5 text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
        {icon ? (
          <ToneTile icon={icon} iconTone={iconTone} size="size-9" glyph={20} />
        ) : null}
        {label}
      </p>

      <div className="mt-1.5 flex flex-col gap-0.5">
        <p
          className={cn(
            "text-[clamp(23px,2vw,28px)] leading-tight font-extrabold tracking-[-0.02em] tabular-nums",
            tones[tone],
          )}
        >
          {value}
        </p>
        {secondary ? (
          <p className="text-[13px] text-(--sv-muted) tabular-nums">
            {secondary}
          </p>
        ) : null}
      </div>

      {/*
        Pushed to the foot of the card rather than left under the figure.

        Cards in a row are different heights of content, and a caption that
        follows its own figure lands at different heights. Anchored to the
        bottom they line up, and the row reads as one row.
      */}
      {children || footnote ? (
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {children}
          {footnote ? (
            <p className="sv-card-note pt-2.5 text-[13px] text-(--sv-muted)">
              {footnote}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Summary bar                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One figure, with the sentence that says what it is.
 *
 * The explanation is on the left and not underneath, because the figure is
 * what somebody came for and a paragraph above it delays that by a line.
 */
export function SummaryBar({
  label,
  icon,
  iconTone,
  description,
  value,
  secondary,
  actions,
}: {
  label: string;
  icon?: GlyphSource;
  iconTone?: string;
  description?: ReactNode;
  value: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sv-card sv-rise flex flex-wrap items-center justify-between gap-4 rounded-[11px] bg-(--sv-surface) px-6 py-5">
      <div className="flex min-w-0 items-center gap-3.5">
        {icon ? (
          <ToneTile
            icon={icon}
            iconTone={iconTone}
            size="size-[46px]"
            glyph={24}
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold tracking-[0.14em] text-(--sv-muted) uppercase">
            {label}
          </p>
          {description ? (
            <p className="mt-1 text-[13px] text-(--sv-muted)">{description}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-[clamp(26px,2.4vw,34px)] leading-tight font-extrabold tracking-[-0.02em] tabular-nums">
            {value}
          </p>
          {secondary ? (
            <p className="text-[13px] text-(--sv-muted) tabular-nums">
              {secondary}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Data panel                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A card holding a table, with the horizontal scroll INSIDE it.
 *
 * That last part is the rule worth keeping: a wide table that makes the whole
 * page scroll sideways takes the sidebar and the heading with it. Scrolling
 * within the card leaves the rest of the screen where it was.
 */
export function DataPanel({
  title,
  icon,
  iconTone,
  description,
  actions,
  children,
  footnote,
  className,
}: {
  title?: string;
  icon?: GlyphSource;
  iconTone?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "sv-card overflow-hidden rounded-[11px] bg-(--sv-surface)",
        className,
      )}
    >
      {title ? (
        <header className="sv-panel-head flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-[11px]">
            {icon ? (
              <ToneTile
                icon={icon}
                iconTone={iconTone}
                size="size-9"
                glyph={20}
              />
            ) : null}
            <div className="min-w-0">
              <h2 className="text-[17px] font-extrabold">{title}</h2>
              {description ? (
                <p className="mt-px text-[12.5px] text-(--sv-muted)">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}

      <div className="overflow-x-auto">{children}</div>

      {footnote ? (
        <p className="sv-card-note px-5 py-3 text-[12.5px] text-(--sv-muted)">
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status pill                                                                */
/* -------------------------------------------------------------------------- */

export type PillTone =
  "positive" | "negative" | "warning" | "neutral" | "primary";

/**
 * Active, Paid, Draft, Cash in.
 *
 * A tone rather than a colour at the call site, so "what does amber mean" has
 * one answer across the app instead of one per screen. The handoff's pills
 * carry a dot in their own colour; `primary` is its violet "Active".
 */
export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<PillTone, string> = {
    positive: "bg-(--sv-pos-tint) text-(--sv-pos)",
    negative: "bg-(--sv-neg-tint) text-(--sv-neg)",
    warning: "bg-(--sv-warn-tint) text-(--sv-warn)",
    neutral: "bg-(--sv-subtle) text-(--sv-muted)",
    primary: "bg-(--sv-violet-tint) text-(--sv-violet-ink)",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] leading-[1.2] font-extrabold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 flex-none rounded-full",
          tone === "primary" ? "bg-(--sv-violet)" : "bg-current",
        )}
      />
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Progress bar                                                               */
/* -------------------------------------------------------------------------- */

export function ShareBar({
  share,
  tone,
  className,
}: {
  /** 0–1. Anything outside is clamped, because a bar past its track is a bug
   *  that looks like a design. */
  share: number;
  tone?: string;
  className?: string;
}) {
  const width = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-(--sv-track)",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full", tone ?? "bg-(--sv-violet)")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Nothing here yet, and what to do about it.
 *
 * The action is required rather than optional: an empty state that only says
 * "no data" leaves somebody looking for the button, and the button is usually
 * somewhere they have already looked.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: GlyphSource;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="sv-empty-tile grid size-16 place-items-center rounded-full bg-(--sv-lime-tint) text-(--sv-violet)">
        <Glyph icon={icon} size={32} />
      </span>
      <p className="text-[19px] font-extrabold">{title}</p>
      {children ? (
        <p className="max-w-[46ch] text-[14px] leading-relaxed text-(--sv-muted)">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section heading                                                            */
/* -------------------------------------------------------------------------- */

/** A title, a grey qualifier, and something on the right — the dashboard's. */
export function SectionHeading({
  title,
  icon,
  iconTone,
  qualifier,
  subtitle,
  aside,
}: {
  title: string;
  icon?: GlyphSource;
  iconTone?: string;
  qualifier?: ReactNode;
  /** A small line under the title — a bank's name under an account's. */
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex flex-wrap items-center gap-x-[9px] gap-y-1 text-[17px] font-extrabold">
          {icon ? (
            <Glyph
              icon={icon}
              size={21}
              className={iconTone ?? "text-(--sv-violet)"}
            />
          ) : null}
          {title}
          {qualifier ? (
            <span className="ml-0.5 text-[13.5px] font-medium text-(--sv-muted)">
              {qualifier}
            </span>
          ) : null}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[12.5px] text-(--sv-muted)">
            {subtitle}
          </p>
        ) : null}
      </div>
      {aside}
    </div>
  );
}
