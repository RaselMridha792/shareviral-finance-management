"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Ticking rows, and knowing which are ticked.
 *
 * The owner's complaint was arithmetic: "akhon to prottekta one by one trash a
 * felte hoy". Forty rows meant forty confirmations.
 *
 * Two decisions are baked in here rather than left to each screen, because a
 * tick that means something different on two tables is worse than no tick:
 *
 * **Select-all means THIS PAGE.** Eight of the nine tables that get a tick
 * column are paged by the server and hold twenty ids at a time; there is no
 * endpoint that returns "every id matching this filter", and the pager caps a
 * page at 200. So "everything" is not buildable on most of them, and shipping
 * it on the few client-sliced screens would make one control mean two things.
 * The header tick says "the twenty you can see", and the bar says so too.
 *
 * **The selection survives paging but is pruned by it.** Moving to page two
 * and back must not silently drop what was ticked — but a row that has left
 * the table entirely (filtered away, deleted by somebody else, refreshed out
 * of existence) must not stay in a count the reader cannot see. `visible`
 * reconciles the two: it is what the bar counts and what the request sends.
 */
export function useBulkSelect<T extends { id: string }>(rows: T[]) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  const onPage = useMemo(() => rows.map((r) => r.id), [rows]);

  /*
   * Only rows still on the screen. A ticked id that has since gone is dropped
   * from every count and from the request — never silently kept.
   */
  const visible = useMemo(
    () => rows.filter((r) => ticked.has(r.id)),
    [rows, ticked],
  );

  const toggle = useCallback((id: string) => {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allOnPage = useCallback(() => {
    setTicked((current) => {
      const everyOne = onPage.every((id) => current.has(id));
      const next = new Set(current);
      // Ticking the header when everything here is already ticked unticks it —
      // the same control both ways, which is what people expect of it.
      for (const id of onPage) {
        if (everyOne) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [onPage]);

  const clear = useCallback(() => setTicked(new Set()), []);

  const headerState: "none" | "some" | "all" =
    onPage.length === 0 || visible.length === 0
      ? "none"
      : onPage.every((id) => ticked.has(id))
        ? "all"
        : "some";

  return {
    /** The rows still on screen and ticked — what the bar counts and sends. */
    selected: visible,
    count: visible.length,
    isTicked: (id: string) => ticked.has(id),
    toggle,
    allOnPage,
    clear,
    /** "some" drives the indeterminate box; nothing else in the app uses one. */
    headerState,
  };
}
