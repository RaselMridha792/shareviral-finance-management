"use client";

import { usePathname } from "next/navigation";

import Link from "next/link";

import { trailFor, useLeafCrumb } from "@/components/layout/breadcrumb";
import { MobileSidebar } from "@/components/layout/sidebar";
import {
  toggleSidebar,
  useSidebarCollapsed,
} from "@/components/layout/sidebar-state";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
  /*
    The rail knows the ancestors; only the page knows the record. A team
    member's name is not in `nav-items.ts` and never will be, so the screen
    supplies it and it lands here as the last crumb.
  */
  const trail = trailFor(pathname);
  const leaf = useLeafCrumb();
  const crumbs = leaf ? [...trail, { label: leaf }] : trail;
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
        {/*
          Finance, then every level down to here.

          "Finance" is not a link: it names the product, and a link that goes
          nowhere in particular is what teaches people to stop trusting a
          breadcrumb. Everything between it and the last crumb is, because
          climbing one level is the whole reason this row exists. The last
          crumb is where you already are, so it stays plain.
        */}
        <nav aria-label="Breadcrumb" className="min-w-0">
          <p className="truncate text-sm">
            <span className="text-muted-foreground">Finance</span>
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <span key={`${crumb.label}-${i}`}>
                  <span className="mx-1.5 text-faint">/</span>
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="rounded-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={
                        last
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }
                    >
                      {crumb.label}
                    </span>
                  )}
                </span>
              );
            })}
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
