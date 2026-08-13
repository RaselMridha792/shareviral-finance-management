"use client";

import type { FormatMoneyOptions } from "@finance/shared";

import { useMoney } from "@/components/settings-provider";
import { cn } from "@/lib/utils";

/**
 * The single place an amount is rendered.
 *
 * One component so the design rules — mono, tabular figures, slashed zero,
 * right alignment, explicit sign — cannot drift apart across screens.
 */
export function Amount({
  value,
  tone = "auto",
  approximate = false,
  className,
  ...options
}: {
  value: string | number;
  /**
   * Marks a figure as a translation rather than a record.
   *
   * A dollar amount produced from a taka amount at one rate is an estimate,
   * and an estimate that looks identical to a recorded figure is the thing
   * this whole app is careful about. The tilde is the cheapest honest signal
   * there is.
   */
  approximate?: boolean;
  /**
   * `auto` colours negatives red and leaves positives neutral — a balance is
   * not "good news green", it is just a number. Use `in`/`out` on a ledger row
   * where direction is the point.
   */
  tone?: "auto" | "neutral" | "in" | "out";
  className?: string;
} & FormatMoneyOptions) {
  const money = useMoney();
  const text = (approximate ? "~" : "") + money(value, options);
  const negative = String(value).trim().startsWith("-");

  return (
    <span
      title={approximate ? "Approximate — converted from taka" : undefined}
      className={cn(
        "col-amount",
        tone === "auto" && negative && "text-negative",
        tone === "in" && "text-positive",
        tone === "out" && "text-negative",
        className,
      )}
    >
      {text}
    </span>
  );
}
