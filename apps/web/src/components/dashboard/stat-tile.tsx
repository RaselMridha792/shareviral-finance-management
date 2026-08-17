"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { ComponentType } from "react";

import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One figure, its icon, and whether it moved.
 *
 * The change arrow follows *meaning*, not direction: spending more is not an
 * improvement, so its rising arrow is red while income's is green. Getting
 * that backwards makes a dashboard actively misleading at a glance, which is
 * the only way this screen is ever read.
 */
export function StatTile({
  label,
  value,
  usd,
  hint,
  change,
  risingIsGood = true,
  tone = "neutral",
  icon: Icon,
  accent = "muted",
}: {
  label: string;
  value: string;
  /**
   * The same figure in dollars, approximate. Rendered smaller and prefixed
   * with a tilde: it is a translation of the taka at one rate, not a second
   * recorded amount, and it must never read as one.
   */
  usd?: string | null;
  hint?: string;
  change?: number | null;
  risingIsGood?: boolean;
  tone?: "in" | "out" | "neutral";
  icon: ComponentType<{ className?: string }>;
  accent?: "muted" | "primary" | "positive" | "negative" | "warning";
}) {
  const rising = (change ?? 0) >= 0;
  const good = risingIsGood ? rising : !rising;
  const Trend = rising ? TrendingUp : TrendingDown;

  const accents: Record<string, string> = {
    muted: "bg-surface-muted text-muted-foreground",
    primary: "bg-primary/12 text-primary",
    positive: "bg-positive/12 text-positive",
    negative: "bg-negative/12 text-negative",
    warning: "bg-warning/12 text-warning",
  };

  const showsFooter =
    (change !== undefined && change !== null) || Boolean(hint);

  return (
    <Card className="flex flex-col p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        {/* Smaller than the body scale on purpose. This is a caption naming
            the figure below it, not text anybody reads — at 13px uppercase it
            wrapped to two lines and pushed the figures in a row out of line
            with each other. */}
        <p className="text-[0.6875rem] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          {label}
        </p>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            accents[accent],
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>

      {/* The taka and its dollars are one unit: a tight pair with the pair
          itself separated from everything around it, so the eye reads them
          together rather than as two unrelated lines. */}
      <div className="mt-3 flex flex-col gap-1">
        {/*
          This tile draws its own dollar line just below, from a figure the
          report converted at the *period's* rate. Letting the component add a
          second one at today's rate would put two different dollar amounts
          under one taka figure.
        */}
        <Amount
          value={value}
          tone={tone === "neutral" ? "auto" : tone}
          showCounterpart={false}
          className="block text-xl font-semibold tracking-tight sm:text-2xl"
        />

        {usd ? (
          <Amount
            value={usd}
            currency="USD"
            tone="neutral"
            className="block text-sm font-medium text-muted-foreground"
            approximate
          />
        ) : null}
      </div>

      {/* Only when there is something to say. An empty row still has padding,
          and four tiles with different amounts of it stop lining up. */}
      {showsFooter ? (
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-xs">
          {change !== undefined && change !== null ? (
            <span
              className={cn(
                "num inline-flex items-center gap-1 font-medium",
                good ? "text-positive" : "text-negative",
              )}
            >
              <Trend className="size-3.5" />
              {rising ? "+" : "−"}
              {Math.abs(change).toFixed(1)}%
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}

/** Null when there is no previous figure — "+100%" from zero is meaningless. */
export function percentChange(
  current: string,
  previous: string | undefined,
): number | null {
  if (previous === undefined) return null;
  const before = Number(previous);
  if (before === 0) return null;
  return ((Number(current) - before) / before) * 100;
}
