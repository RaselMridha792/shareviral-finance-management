"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Taka per dollar, for the whole signed-in app.
 *
 * Every figure in this system is recorded in taka, and the people reading it
 * are not all in Dhaka: the CEO funds the company in dollars and thinks in
 * them. So each amount is shown twice — once as it was recorded, once
 * translated — and the translation is marked every time.
 *
 * One rate for the app rather than one per period. That is a real
 * simplification and worth stating: a July figure on screen in August is
 * converted at August's rate, so its dollar line is "what that taka is worth
 * today", not "what it was worth then". For a company whose dollars arrive as
 * remittances and are spent in taka, today's worth is the useful question, and
 * the alternative — a different rate per row depending on when it happened —
 * is a page where two identical taka amounts show different dollars.
 *
 * The figures that genuinely have their own rate keep it: a remittance stores
 * the rate it landed at, and the statement shows each entry's own. Those are
 * recorded facts. This is the everyday translation on top of everything else.
 *
 * Null when no rate has ever been recorded, and then nothing is shown rather
 * than something invented.
 */
const RateContext = createContext<string | null>(null);

export function RateProvider({
  rate,
  children,
}: {
  rate: string | null;
  children: ReactNode;
}) {
  return <RateContext.Provider value={rate}>{children}</RateContext.Provider>;
}

/** Taka per dollar, or null when none is on file. */
export function useUsdRate(): number | null {
  const raw = useContext(RateContext);
  if (!raw) return null;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}
