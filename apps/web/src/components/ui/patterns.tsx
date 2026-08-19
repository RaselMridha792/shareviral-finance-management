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
 * The dividers are the trick. A 1px gap over a hairline-coloured background
 * gives a true hairline between cells — and, unlike a border on each cell, it
 * survives wrapping: when the grid drops to two columns the rules land in the
 * new places by themselves instead of leaving a stray edge where a row broke.
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
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
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

export function StatCell({
  label,
  icon,
  iconTone,
  value,
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
  /** The "≈ $…" line under the figure. */
  secondary?: ReactNode;
  footnote?: ReactNode;
  /** The closing figure of a set sits on the raised surface. */
  emphasis?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 px-6 py-[23px]",
        emphasis ? "bg-surface-muted" : "bg-surface",
      )}
    >
      <p className="flex items-center gap-1.5 text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase">
        {icon ? (
          <Icon name={icon} size={17} className={iconTone ?? "text-faint"} />
        ) : null}
        {label}
      </p>
      <p className="num text-[clamp(22px,1.8vw,28px)] leading-tight font-medium text-foreground">
        {value}
      </p>
      {secondary ? <p className="num text-xs text-faint">{secondary}</p> : null}
      {children}
      {footnote ? (
        <p className="text-xs text-muted-foreground">{footnote}</p>
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
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        {icon ? (
          <Icon name={icon} size={21} className={iconTone ?? "text-faint"} />
        ) : null}
        {title}
        {qualifier ? (
          <span className="text-sm font-normal text-muted-foreground">
            {qualifier}
          </span>
        ) : null}
      </h2>
      {aside}
    </div>
  );
}
