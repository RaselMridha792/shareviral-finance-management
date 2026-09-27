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
     * The September handoff's column: 24px all round, blocks 18px apart, and
     * a ceiling of 1560px, centred.
     *
     * The ceiling is not the old `max-w-7xl`. That one stopped at 1280px and
     * left two columns of empty space either side of every screen on an
     * ordinary monitor while a fourteen-column table scrolled sideways inside a
     * card with room to spare. 1560 is wide enough that only a genuinely large
     * screen meets it, and there a line of figures stops stretching across a
     * width nobody reads at. Phones keep a 16px gutter rather than 24.
     */
    <main className="w-full max-w-[1560px] flex-1 self-center p-[clamp(16px,2vw,24px)]">
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
