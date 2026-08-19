"use client";

import { useEffect } from "react";
import { useSyncExternalStore } from "react";

import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";

/**
 * The path across the top of every screen, and the way back up it.
 *
 * It used to print `Finance / <screen>` — the name of where you are and
 * nothing else, which is a label rather than navigation. Climbing one level
 * meant going to the rail every time.
 *
 * Two halves make the trail. The rail supplies the ancestors, because it
 * already knows the structure and there is no reason to keep a second copy of
 * it in step. The page supplies the last crumb when the last crumb is a record
 * — an account, a person, a payroll run — because only the page knows its name.
 */

export type Crumb = {
  label: string;
  /** Absent on an accordion parent, which is a heading rather than a page. */
  href?: string;
};

/* -------------------------------------------------------------------------- */
/*  The leaf a page names for itself                                           */
/* -------------------------------------------------------------------------- */

let leaf: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Renders nothing; names the page.
 *
 * A detail screen drops this in and the top bar grows a final crumb with the
 * record's own name. It clears itself on the way out, so navigating from a
 * person to a list cannot leave the person's name hanging in the trail.
 *
 * A component rather than a hook because it can then sit in the JSX beside the
 * heading it echoes, where somebody editing that heading will see it.
 */
export function useNameThisPage(label: string | null) {
  useEffect(() => {
    leaf = label;
    emit();
    return () => {
      leaf = null;
      emit();
    };
  }, [label]);
}

export function useLeafCrumb(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => leaf,
    // The server renders the trail without it; the page supplies it on mount.
    () => null,
  );
}

/* -------------------------------------------------------------------------- */
/*  The ancestors, from the rail                                               */
/* -------------------------------------------------------------------------- */

function under(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Every nav row this path sits under, outermost first.
 *
 * Depth-first with the parent pushed before its children, so
 * `/subscriptions` comes back as `Expenses → AI tools and subscriptions`
 * rather than just the leaf. A parent with no `href` is kept as a plain label:
 * it says where you are without pretending to be somewhere you can go.
 */
export function trailFor(pathname: string): Crumb[] {
  let best: Crumb[] = [];

  const walk = (items: NavItem[], above: Crumb[]) => {
    for (const item of items) {
      const here: Crumb[] = [...above, { label: item.label, href: item.href }];

      if (item.href && under(pathname, item.href)) {
        // Deepest wins: /accounts/cash-in must not stop at /accounts.
        const depth = item.href.length;
        const bestDepth = best.at(-1)?.href?.length ?? -1;
        if (depth > bestDepth) best = here;
      }

      if (item.children) walk(item.children, here);
    }
  };

  for (const group of NAV_GROUPS) walk(group.items, []);
  walk(SECONDARY_NAV, []);

  return best;
}
