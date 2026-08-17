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
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
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
