"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Every screen is a document in a padded column — except the assistant, which
 * is a room.
 *
 * A conversation wants the composer pinned to the bottom of the window and the
 * transcript scrolling above it, which cannot happen inside a column that grows
 * with its content. Rather than teach every page about its own chrome, the one
 * route that needs the whole viewport says so here.
 */
const FULL_BLEED = ["/assistant"];

export function MainRegion({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED.some((route) => pathname.startsWith(route));

  if (fullBleed) {
    // min-h-0 so a flex child may scroll instead of pushing the page taller.
    return <main className="min-h-0 flex-1">{children}</main>;
  }

  return (
    /**
     * The September handoff's column: 24px all round, blocks 18px apart.
     *
     * The ceiling is 1920px. It was 1560, and on the owner's own 1920px screen
     * that left every page 69px in from the rail and 69px in from the edge —
     * the owner: *"prottek page a dui pase je gap ache ... ei gap ta komate
     * hobe"*. Now the column fills the room beside the rail on any ordinary
     * monitor, with only its 24px padding either side (`.gapqa.mjs` measures
     * it); the ceiling is only ever met on an ultra-wide screen, where a line
     * of figures would otherwise stretch across a width nobody reads at.
     * Phones keep a 16px gutter rather than 24.
     */
    <main className="w-full max-w-[1920px] flex-1 self-center p-[clamp(16px,2vw,24px)]">
      {/*
        Nothing follows the last block. A rate caption used to close every
        screen but the dashboard — "Dollar figures are approximate, translated
        from BDT at 121.50 per USD…" — and then a rate chip in the top bar kept
        that promise. The owner had both removed; the rate lives in Settings →
        Exchange rate.
      */}
      <div className="flex flex-col gap-[18px]">{children}</div>
    </main>
  );
}
