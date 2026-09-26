"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Preloader } from "./preloader";

/**
 * When the preloader is shown: between signing in and the app being there.
 *
 * The handoff calls it the boot loader "shown before the app" and says no more.
 * The one moment this app genuinely has something to wait for is that one — the
 * password is accepted and the dashboard is being built on the server. Every
 * other navigation is a click inside a working app, and a four-second ceremony
 * on each would be a four-second tax on every click. Nor on a plain reload or a
 * new tab: those arrive already server-rendered, and a curtain over a page that
 * is already there only hides it.
 *
 * WHY IT LIVES IN THE ROOT LAYOUT. The sign-in page is unmounted the moment the
 * dashboard commits, so a preloader drawn by the form would vanish mid-arrow.
 * The root layout survives the navigation, so the overlay can watch the path
 * change underneath it and only then finish. It renders nothing at all until
 * the form calls `startBoot()`, so no other screen is touched by being here.
 */

type Boot = { id: number; from: string };

let boot: Boot | null = null;
let count = 0;
const listeners = new Set<() => void>();

function publish(next: Boot | null) {
  boot = next;
  listeners.forEach((listener) => listener());
}

/** Called by the sign-in form the moment the session exists. */
export function startBoot() {
  count += 1;
  publish({ id: count, from: window.location.pathname });
}

function endBoot() {
  publish(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function BootOverlay() {
  const current = useSyncExternalStore(
    subscribe,
    () => boot,
    () => null,
  );
  const pathname = usePathname();

  if (!current) return null;
  return (
    <Preloader
      key={current.id}
      arrived={pathname !== current.from}
      onDone={endBoot}
    />
  );
}
