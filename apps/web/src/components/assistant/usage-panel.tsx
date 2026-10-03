"use client";

import type { AiUsageSummary, AiUsageTotals } from "@finance/shared";
import { ArrowRight, ChevronRight, Gauge, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useAssistant } from "@/components/assistant/assistant-provider";
import { cn } from "@/lib/utils";

/**
 * Dollars of an estimate, as text: two places from a dollar up, four below
 * it — a turn on Gemini Flash is a fraction of a cent, and "$0.00" beside a
 * hundred calls would say nothing.
 */
export function usd(text: string | null): string {
  if (text === null) return "no price known";
  const value = Number(text);
  if (!Number.isFinite(value)) return `$${text}`;
  return value >= 1
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${value.toFixed(4)}`;
}

export function tokens(count: number): string {
  return count.toLocaleString("en-US");
}

/** "2026-10" as "October 2026". */
export function monthName(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Every token kind that was counted, a line each. */
export function TokenLines({ totals }: { totals: AiUsageTotals }) {
  const lines: Array<[string, number]> = [
    ["Input", totals.inputTokens],
    ["Read from the cache", totals.cacheReadTokens],
    ["Written to the cache", totals.cacheWriteTokens],
    ["Output", totals.outputTokens],
    ...(totals.thinkingTokens
      ? ([["Thinking (Gemini)", totals.thinkingTokens]] as Array<
          [string, number]
        >)
      : []),
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px]">
      {lines.map(([label, count]) => (
        <div key={label} className="contents">
          <dt className="text-(--sv-muted)">{label}</dt>
          <dd className="num text-right font-extrabold">{tokens(count)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * This month's spending, against the company's limit (B3, 4 Oct 2026): the
 * tokens, what they come to at the providers' prices, the limit and how much
 * of it is used. Every dollar figure is an estimate; the invoice is the real
 * one, and the panel says so.
 */
export function UsageSummaryView({ usage }: { usage: AiUsageSummary | null }) {
  if (!usage) {
    return <p className="text-[13px] text-(--sv-muted)">Reading…</p>;
  }
  const { totals, limitUsd, usedShare, state } = usage;
  const share = usedShare === null ? 0 : Math.min(usedShare, 1);
  const tone =
    state === "stopped"
      ? "bg-(--sv-neg)"
      : state === "warning"
        ? "bg-warning"
        : "bg-(--sv-violet)";

  return (
    <div className="flex flex-col gap-4" data-usage-state={state}>
      <div>
        <p className="text-[12px] font-extrabold tracking-[0.06em] text-(--sv-muted) uppercase">
          {monthName(usage.month)}
        </p>
        <p className="num mt-1 text-[26px] leading-tight font-extrabold">
          {usd(totals.costUsd)}
        </p>
        <p className="text-[12px] text-(--sv-muted)">
          Estimated from {tokens(totals.calls)}{" "}
          {totals.calls === 1 ? "call" : "calls"} to a model. The
          provider&rsquo;s invoice is the real figure.
          {totals.unpricedCalls
            ? ` ${tokens(totals.unpricedCalls)} had no price known, and are not in it.`
            : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {limitUsd ? (
          <>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-(--sv-muted)">Monthly limit</span>
              <span className="num font-extrabold">
                {usd(limitUsd)} · {Math.floor((usedShare ?? 0) * 100)}% used
              </span>
            </div>
            <div
              role="meter"
              aria-label="How much of this month's limit is used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
              className="h-2 overflow-hidden rounded-full bg-surface-muted"
            >
              <div
                className={cn("h-full rounded-full", tone)}
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-(--sv-muted)">
            No monthly limit is set.
          </p>
        )}
        {usage.message ? (
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-[12.5px]",
              state === "stopped"
                ? "bg-negative/10 text-negative"
                : "bg-warning/10 text-foreground",
            )}
          >
            {usage.message}
          </p>
        ) : null}
      </div>

      <TokenLines totals={totals} />

      <Link
        href="/assistant/settings#usage"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
      >
        By day, person and model
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

const FOLDED = "sfm.assistant.usage.folded";

/**
 * The panel on the right of the chat, on a wide screen: folded to a narrow
 * strip with one press, and remembered so in this browser.
 */
export function UsageAside() {
  const { usage, loadUsage } = useAssistant();
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    void loadUsage();
    try {
      // Read after the first paint: the server draws it open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFolded(window.localStorage.getItem(FOLDED) === "1");
    } catch {
      // A browser that keeps nothing shows it open.
    }
  }, [loadUsage]);

  function fold(next: boolean) {
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED, next ? "1" : "0");
    } catch {
      // Not remembered; it still folds.
    }
  }

  if (folded) {
    return (
      <aside className="hidden w-12 shrink-0 border-l border-border xl:flex xl:flex-col xl:items-center xl:pt-3">
        <button
          type="button"
          onClick={() => fold(false)}
          aria-label="Show usage"
          title="Usage this month"
          className="grid size-9 cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition hover:bg-(--sv-violet-tint) hover:text-(--sv-violet-ink)"
        >
          <Gauge className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Usage this month"
      className="hidden w-72 shrink-0 overflow-y-auto border-l border-border xl:block"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
          <Gauge className="size-4 text-(--sv-violet)" />
          Usage
        </h2>
        <button
          type="button"
          onClick={() => fold(true)}
          aria-label="Hide usage"
          title="Hide"
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition hover:bg-surface-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="px-4 pb-4">
        <UsageSummaryView usage={usage} />
      </div>
    </aside>
  );
}

/** The same panel, over the chat, behind the Usage button on a phone. */
export function UsageDrawer({ onClose }: { onClose: () => void }) {
  const { usage, loadUsage } = useAssistant();

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button
        type="button"
        aria-label="Close usage"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        role="dialog"
        aria-label="Usage this month"
        className="absolute inset-y-0 right-0 flex w-80 max-w-[90vw] flex-col overflow-y-auto border-l border-border bg-(--sv-surface)"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
            <Gauge className="size-4 text-(--sv-violet)" />
            Usage
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close usage"
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 pb-4">
          <UsageSummaryView usage={usage} />
        </div>
      </div>
    </div>
  );
}
