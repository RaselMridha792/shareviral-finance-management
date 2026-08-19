import type { ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The structural patterns every screen is built from.
 *
 * They live together and are used rather than re-invented per page, which is
 * the whole point: eighteen screens that each drew their own "four figures in a
 * row" is eighteen slightly different rows, and the difference is always
 * visible and never intended.
 */

/* -------------------------------------------------------------------------- */
/*  Stat strip                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Several figures across one bordered panel.
 *
 * The dividers are the trick, and the obvious way to draw them is wrong. A 1px
 * gap over a hairline-coloured background gives true hairlines that survive
 * wrapping — but when four cells wrap to three-and-one, the two empty columns
 * beside the last one show that hairline colour as a grey block the width of
 * half the card. It looked like a broken cell, because it was the panel's
 * background showing through where nothing was drawn.
 *
 * So the cells rule themselves instead: each paints a hairline on its own left
 * and top edge, and paint order puts that line over the neighbour it abuts.
 * The panel's own border covers the outermost ones, and empty space at the end
 * of a wrapped row is just the card.
 */
export function StatStrip({
  children,
  min = 244,
  className,
}: {
  children: ReactNode;
  /** Narrowest a cell may get before the grid wraps. */
  min?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-xl border border-border bg-surface shadow-e1",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
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
  /** A Material Symbols name, coloured by meaning rather than decoration. */
  icon?: string;
  iconTone?: string;
  value: ReactNode;
  /**
   * The figure's own colour. Money arriving is green and money leaving is red
   * — the same rule the ledger rows follow, so a cell and a row never say
   * different things about the same direction.
   */
  tone?: StatTone;
  /** The "≈ $…" line under the figure. */
  secondary?: ReactNode;
  footnote?: ReactNode;
  /** The closing figure of a set sits on the raised surface. */
  emphasis?: boolean;
  children?: ReactNode;
}) {
  const tones: Record<StatTone, string> = {
    default: "text-foreground",
    positive: "text-positive",
    negative: "text-negative",
  };

  return (
    <div
      className={cn(
        // The hairlines. See StatStrip — a cell rules its own left and top.
        "flex flex-col gap-3 px-[22px] pt-[22px] pb-5",
        "shadow-[-1px_0_0_0_var(--border),0_-1px_0_0_var(--border)]",
        emphasis ? "bg-surface-muted" : "bg-surface",
      )}
    >
      <p className="flex items-center gap-[9px] text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase">
        {icon ? (
          <Icon name={icon} size={17} className={iconTone ?? "text-faint"} />
        ) : null}
        {label}
      </p>

      <div className="flex flex-col gap-[3px]">
        <p
          className={cn(
            "num text-[clamp(22px,1.8vw,28px)] leading-tight font-medium tracking-[-0.02em]",
            tones[tone],
          )}
        >
          {value}
        </p>
        {secondary ? (
          <p className="num text-[13.5px] text-faint">{secondary}</p>
        ) : null}
      </div>

      {/*
        Pushed to the foot of the cell rather than left under the figure.

        Four cells in a strip are four different heights of content, and a
        caption that follows its own figure lands at four different heights.
        Anchored to the bottom they line up, and the strip reads as one row
        instead of four boxes.
      */}
      {children || footnote ? (
        <div className="mt-auto flex flex-col gap-1.5 pt-2">
          {children}
          {footnote ? (
            <p className="text-[13px] text-muted-foreground">{footnote}</p>
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
  icon?: string;
  iconTone?: string;
  description?: ReactNode;
  value: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-6 py-[23px]">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase">
          {icon ? (
            <Icon name={icon} size={17} className={iconTone ?? "text-faint"} />
          ) : null}
          {label}
        </p>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="num text-[clamp(25px,2vw,32px)] leading-tight font-semibold text-foreground">
            {value}
          </p>
          {secondary ? (
            <p className="num text-xs text-faint">{secondary}</p>
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
  icon?: string;
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
        "overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-[18px]">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              {icon ? (
                <Icon
                  name={icon}
                  size={19}
                  className={iconTone ?? "text-faint"}
                />
              ) : null}
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2">{actions}</div>
          ) : null}
        </header>
      ) : null}

      <div className="overflow-x-auto">{children}</div>

      {footnote ? (
        <p className="border-t border-border-soft px-6 py-3 text-xs text-muted-foreground">
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status pill                                                                */
/* -------------------------------------------------------------------------- */

export type PillTone = "positive" | "negative" | "warning" | "neutral";

/**
 * Active, Paid, Draft, Cash in.
 *
 * A tone rather than a colour at the call site, so "what does amber mean" has
 * one answer across the app instead of one per screen.
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
    positive: "bg-tag-positive-bg text-tag-positive-fg",
    negative: "bg-tag-negative-bg text-tag-negative-fg",
    warning: "bg-warning/15 text-warning",
    neutral: "bg-tag-bg text-tag-fg",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
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
        "h-1 w-full overflow-hidden rounded-sm bg-border-soft",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-sm", tone ?? "bg-primary")}
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
  icon: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] px-6 py-14 text-center">
      <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15">
        <Icon name={icon} size={26} className="text-primary-text" />
      </span>
      <p className="text-lg font-semibold text-foreground">{title}</p>
      {children ? (
        <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      ) : null}
      {action}
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
  aside,
}: {
  title: string;
  icon?: string;
  iconTone?: string;
  qualifier?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex flex-wrap items-center gap-x-[9px] gap-y-1 text-[17px] font-semibold text-foreground">
        {icon ? (
          <Icon name={icon} size={21} className={iconTone ?? "text-faint"} />
        ) : null}
        {title}
        {qualifier ? (
          <span className="ml-0.5 text-[13.5px] font-normal text-muted-foreground">
            {qualifier}
          </span>
        ) : null}
      </h2>
      {aside}
    </div>
  );
}
