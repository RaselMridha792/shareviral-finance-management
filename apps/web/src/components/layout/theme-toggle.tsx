"use client";

import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const THEME_EVENT = "ledgerly:themechange";

/** The ground each theme paints behind the page, for overscroll. */
const GROUND: Record<Theme, string> = { light: "#f1f3ec", dark: "#0c0f08" };

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
  // Light, matching the bootstrap script.
  return "light";
}

/**
 * The handoff's switch: a sun or a moon and the NAME of the theme it would
 * switch to, so the button says what pressing it does rather than what is
 * already on screen.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    document.documentElement.dataset.theme = next;
    // The overscroll ground, so the page does not bounce against the wrong
    // colour — the same thing the bootstrap script does on first paint.
    document.documentElement.style.backgroundColor = GROUND[next];
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
      aria-label={`Switch to ${next} theme`}
      title="Switch theme"
      className="inline-flex h-10.5 shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-(--sv-subtle) px-3.25 text-[12.5px] font-extrabold transition-colors hover:bg-(--sv-violet-tint)"
    >
      {theme === "dark" ? (
        <SunIcon weight="duotone" size={19} className="text-(--sv-violet)" />
      ) : (
        <MoonIcon weight="duotone" size={19} className="text-(--sv-violet)" />
      )}
      <span className="hidden tracking-[0.08em] uppercase sm:inline">
        {next}
      </span>
    </button>
  );
}

/**
 * Applies the stored theme before first paint so nobody sees a flash of the
 * other one. Rendered in <head> as a blocking inline script.
 *
 * LIGHT unless somebody has said otherwise — the September handoff draws the
 * app light by default. (The August design was the other way round, lime on
 * near-black, and anybody who pressed the switch then keeps what they chose:
 * only an empty preference follows the new default.) Not the operating
 * system's preference: somebody opening the app for the first time should see
 * the design, not a coin toss made by their laptop.
 *
 * The document background is painted here too, so the overscroll area matches
 * before React has rendered anything.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("svf-theme-brand");if(t!=="light"&&t!=="dark"){t="light"}var d=document.documentElement;d.dataset.theme=t;d.style.backgroundColor=t==="dark"?"${GROUND.dark}":"${GROUND.light}"}catch(e){document.documentElement.dataset.theme="light"}})();`;
