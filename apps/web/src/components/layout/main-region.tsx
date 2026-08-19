"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { RateCaption } from "@/components/money/rate-caption";

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
      {/* 20px, not 24. The handoff stacks its blocks at 16–20, and at 24 the
          three sections of the dashboard read as three pages. */}
      <div className="flex flex-col gap-5">
        {children}
        {/*
          Under every screen, because every screen now shows dollar figures
          translated from taka and a translated figure that does not say what
          rate produced it is a number nobody can check. Here rather than on
          each page: one rate governs the whole app, so the sentence belongs in
          one place.
        */}
        <RateCaption />
      </div>
    </main>
  );
}
