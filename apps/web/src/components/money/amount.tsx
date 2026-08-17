"use client";

import type { FormatMoneyOptions } from "@finance/shared";

import { useUsdRate } from "@/components/money/rate-provider";
import { useMoney, useSettings } from "@/components/settings-provider";
import { cn } from "@/lib/utils";

/**
 * The single place an amount is rendered.
 *
 * One component so the design rules — mono, tabular figures, slashed zero,
 * right alignment, explicit sign — cannot drift apart across screens.
 *
 * Since 2026-08-17 it also carries the other currency underneath. Doing that
 * here rather than at each of the sixty-odd call sites is the whole point: a
 * rule applied in one place cannot be forgotten on the screen nobody thought
 * of, and every screen written after today gets it without being told.
 */
export function Amount({
  value,
  tone = "auto",
  approximate = false,
  showCounterpart = true,
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
   * The second line, in the other currency.
   *
   * On by default. Turned off in three situations, and only those: where the
   * caller already renders both currencies itself (the dashboard tiles, the
   * statement's paired figures, the cash-in list); where the amount sits
   * inside a sentence, since a block underneath would break the line; and on
   * a figure that is itself already a translation, which would otherwise be
   * converted back and shown beside its own source.
   */
  showCounterpart?: boolean;
  /**
   * `auto` colours negatives red and leaves positives neutral — a balance is
   * not "good news green", it is just a number. Use `in`/`out` on a ledger row
   * where direction is the point.
   */
  tone?: "auto" | "neutral" | "in" | "out";
  className?: string;
} & FormatMoneyOptions) {
  const money = useMoney();
  const settings = useSettings();
  const rate = useUsdRate();

  const text = (approximate ? "~" : "") + money(value, options);
  const negative = String(value).trim().startsWith("-");

  const currency = options.currency ?? settings.baseCurrency;
  const counterpart =
    showCounterpart && !approximate && rate
      ? convert(value, currency, settings.baseCurrency, rate)
      : null;

  const figure = (
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

  // `rate` is narrowed by the guard that produced `counterpart`, but only
  // through it — restated here so the compiler can see it too.
  if (!counterpart || !rate) return figure;

  return (
    <span className="inline-flex flex-col items-end">
      {figure}
      <span
        // Not a recorded figure, and it must never be able to pass for one.
        title={`Approximate, converted at ${rate.toFixed(2)} per USD`}
        className="col-amount text-xs font-normal text-muted-foreground"
      >
        ~{money(counterpart.value, { currency: counterpart.currency })}
      </span>
    </span>
  );
}

/**
 * The same amount in the other currency, or null when there is no sensible
 * answer.
 *
 * Only taka ↔ dollars, the one pair this company holds. Anything else returns
 * null rather than reaching for a cross rate nobody recorded.
 */
function convert(
  value: string | number,
  currency: string,
  base: string,
  rate: number,
): { value: string; currency: string } | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  // Zero converts to zero, which says nothing and takes a line to say it.
  if (amount === 0) return null;

  if (currency === base) {
    return { value: (amount / rate).toFixed(2), currency: "USD" };
  }
  if (currency === "USD") {
    return { value: (amount * rate).toFixed(2), currency: base };
  }
  return null;
}
