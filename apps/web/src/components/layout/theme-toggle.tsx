"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const THEME_EVENT = "ledgerly:themechange";

/**
 * The <html data-theme> attribute is the source of truth — it's stamped by the
 * inline head script before first paint, so React subscribes to it rather than
 * owning it. Keeps the toggle free of a flash-of-wrong-theme.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  // Dark, matching the bootstrap script. A server render that guessed light
  // would flash white before hydration corrected it.
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    // The overscroll ground, so a dark app does not bounce against a white
    // edge — the same thing the bootstrap script does on first paint.
    document.documentElement.style.backgroundColor =
      next === "dark" ? "#141417" : "#f7f7f8";
    try {
      localStorage.setItem("svf-theme-brand", next);
    } catch {
      // Private mode / storage disabled — the toggle still works this session.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </button>
  );
}

/**
 * Applies the stored theme before first paint so a dark-mode user never sees
 * a light flash. Rendered in <head> as a blocking inline script.
 */
/**
 * Dark unless somebody has said otherwise.
 *
 * Not the operating system's preference, which is what this used to read. The
 * brand is a lime accent on near-black and it only works one way round: on a
 * white ground the same lime is about 1.4:1 and disappears. Somebody opening
 * the app for the first time should see the design, not a coin toss made by
 * their laptop.
 *
 * The document background is painted here too, so the overscroll area matches
 * before React has rendered anything — otherwise a dark app bounces against a
 * white edge.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("svf-theme-brand");if(t!=="light"&&t!=="dark"){t="dark"}var d=document.documentElement;d.dataset.theme=t;d.style.backgroundColor=t==="dark"?"#141417":"#f7f7f8"}catch(e){document.documentElement.dataset.theme="dark"}})();`;
