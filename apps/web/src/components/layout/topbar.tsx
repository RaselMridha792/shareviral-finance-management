"use client";

import { usePathname } from "next/navigation";

import { MobileSidebar } from "@/components/layout/sidebar";
import {
  toggleSidebar,
  useSidebarCollapsed,
} from "@/components/layout/sidebar-state";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";
import { useUsdRateContext } from "@/components/money/rate-provider";
import { Icon } from "@/components/ui/icon";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The bar across the top: where you are, what a dollar is worth, and the two
 * switches.
 *
 * What is NOT here any more: the avatar, the role and the sign-out. They were
 * the least-used controls in the most prominent place on every screen, and they
 * have gone to the foot of the rail. There was also a permanently disabled
 * search box, searching nothing, which went earlier for the same reason — a
 * control that cannot do the thing it depicts teaches people not to trust the
 * chrome.
 *
 * The rate is stated rather than left to be looked up. Every dollar figure in
 * this app is a translation of a taka one, and this is the number they are all
 * translated at — so it belongs where it is visible from every screen instead
 * of only on the one that sets it.
 */
/** The bordered 36px square both chrome buttons are drawn as. */
const TOGGLE =
  "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border border-border text-muted-foreground transition hover:bg-surface-muted hover:text-foreground";

export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const screen = screenNameFor(pathname);
  const collapsed = useSidebarCollapsed();

  /**
   * The rate the dollar figures on screen were actually worked out at — the
   * same one the footnote names, not the fixed setting.
   *
   * Those two are allowed to differ: the setting is what somebody typed, and
   * this is what the period resolved to. Showing one at the top of the page and
   * the other at the foot is how a reader ends up with two rates and no way to
   * tell which the numbers used.
   */
  const usd = useUsdRateContext();

  return (
    <>
      <header
        className="sticky top-0 z-40 flex min-h-[66px] flex-wrap items-center gap-3 border-b border-border bg-surface"
        style={{ padding: "12px clamp(16px, 3vw, 32px)" }}
      >
        {/* One button, two jobs, matching the design: on a wide screen it
            narrows and widens the rail; on a narrow one there is no rail to
            narrow, so it opens the drawer. */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
          className={cn(TOGGLE, "lg:hidden")}
        >
          <Icon name="menu" size={21} />
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Widen the sidebar" : "Narrow the sidebar"}
          aria-pressed={collapsed}
          title="Show or hide the sidebar"
          className={cn(TOGGLE, "hidden lg:inline-flex")}
        >
          <Icon name={collapsed ? "menu" : "menu_open"} size={21} />
        </button>

        {/* Finance / <screen>. The first half never changes and is not a link:
            it says which product you are in, which matters when this sits in a
            browser beside four other tabs. */}
        <nav aria-label="Breadcrumb" className="min-w-0">
          <p className="truncate text-sm">
            <span className="text-muted-foreground">Finance</span>
            {screen ? (
              <>
                <span className="mx-1.5 text-faint">/</span>
                <span className="font-medium text-foreground">{screen}</span>
              </>
            ) : null}
          </p>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {usd ? (
            <span
              className="hidden items-center gap-1.5 rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex"
              title="Every dollar figure in this app is a translation of a taka one, at this rate."
            >
              <Icon name="lock" size={15} className="text-faint" />
              <span>FX locked</span>
              <span className="num text-foreground">
                ৳{usd.rate.toFixed(2)} / $1
              </span>
            </span>
          ) : null}

          <ThemeToggle />
        </div>
      </header>

      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

/**
 * The deepest nav item whose href this path sits under.
 *
 * Deepest, not first: /accounts/cash-in must read "Cash-In" and not "Accounts",
 * and a longest-prefix match is the only rule that gets that right without a
 * second table of names to keep in step with the rail.
 */
function screenNameFor(pathname: string): string | null {
  let best: { label: string; length: number } | null = null;

  const walk = (items: NavItem[]) => {
    for (const item of items) {
      if (
        item.href &&
        (pathname === item.href || pathname.startsWith(item.href + "/")) &&
        (!best || item.href.length > best.length)
      ) {
        best = { label: item.label, length: item.href.length };
      }
      if (item.children) walk(item.children);
    }
  };

  for (const group of NAV_GROUPS) walk(group.items);
  walk(SECONDARY_NAV);

  return best ? (best as { label: string }).label : null;
}
