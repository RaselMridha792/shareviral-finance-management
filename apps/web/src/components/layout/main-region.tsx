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
     * No max width, and the gutter grows with the viewport.
     *
     * It was `max-w-7xl mx-auto`, which put two columns of empty space either
     * side of every screen on any monitor wider than 1280px — while a table of
     * fourteen columns scrolled sideways inside a card that had room to spare.
     * The handoff has no such column: the gutter is clamp(16px, 3vw, 32px) and
     * the content takes what is left.
     */
    <main
      className="flex-1"
      style={{
        padding: "clamp(22px, 3vw, 34px) clamp(16px, 3vw, 32px) 32px",
      }}
    >
      {/*
        20px, not 24. The handoff stacks its blocks at 16–20, and at 24 the
        three sections of the dashboard read as three pages.

        Nothing follows the last block any more. A rate caption used to close
        every screen but the dashboard — "Dollar figures are approximate,
        translated from BDT at 121.50 per USD…" — so that a translated figure
        said what rate produced it. The owner had it removed app-wide, and the
        promise it carried is kept by the top bar, which states the same rate
        as "FX locked ৳121.50 / $1" on every screen including this one. If that
        chip ever goes, the sentence has to come back somewhere.
      */}
      <div className="flex flex-col gap-5">{children}</div>
    </main>
  );
}
