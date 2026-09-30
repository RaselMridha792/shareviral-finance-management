"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Whether the rail is narrowed, shared between the rail and the top bar.
 *
 * The control that narrows it lives in the top bar and the thing it narrows is
 * the sidebar, so the state cannot belong to either — and threading it through
 * the layout would mean making the whole signed-in shell a client component.
 * A module-level store is the smaller answer: two subscribers, one value, no
 * provider.
 */

const KEY = "svf-sidebar";

let collapsed = false;
const listeners = new Set<() => void>();

/**
 * Read once, lazily, on the first client render.
 *
 * Not at import time: this module is evaluated on the server too, where there
 * is no localStorage, and the value has to start as the server rendered it or
 * React throws the shell away and rebuilds it.
 */
let read = false;

function subscribe(listener: () => void) {
  if (!read) {
    read = true;
    try {
      collapsed = window.localStorage.getItem(KEY) === "rail";
    } catch {
      // Private browsing. The rail still works; only the remembering is lost.
    }
    if (collapsed) queueMicrotask(() => listeners.forEach((l) => l()));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleSidebar() {
  collapsed = !collapsed;
  try {
    window.localStorage.setItem(KEY, collapsed ? "rail" : "full");
  } catch {
    // As above.
  }
  listeners.forEach((listener) => listener());
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => collapsed,
    // The server has no preference to read, so it always renders it wide.
    () => false,
  );
}

/**
 * Whether the rail being drawn is the narrow one — icons only (1 Oct 2026).
 *
 * The owner: *"sidebar hide button a click korle sudhu lekha hide hobe
 * sidebar er icons jate dekha jay and click kore navigate ko kora jay"*.
 * Hiding the rail used to take it to nothing; now it takes it to its icons,
 * each still a link, its name on hover. Given by the desktop rail to every
 * row, the Settings rail and the footer; the mobile drawer is always wide.
 */
export const RailCompactContext = createContext(false);

export function useRailCompact(): boolean {
  return useContext(RailCompactContext);
}
