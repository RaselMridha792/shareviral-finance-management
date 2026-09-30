"use client";

import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { trailFor, useLeafCrumb } from "@/components/layout/breadcrumb";
import { CHROME_BUTTON } from "@/components/layout/chrome";
import { NotificationBell } from "@/components/layout/notification-bell";
import { MobileSidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * The bar across the top: where you are, and the three switches — as the
 * September 2026 handoff draws it.
 *
 * What is NOT here: the avatar, the role and the sign-out. They were the
 * least-used controls in the most prominent place on every screen, and they
 * live at the foot of the rail. There was also a permanently disabled search
 * box, searching nothing, which went for the same reason — a control that
 * cannot do the thing it depicts teaches people not to trust the chrome. And
 * the "FX locked ৳x / $1" chip is off on the owner's instruction: with it and
 * the dashboard's rate caption both gone, the rate the dollar figures are
 * translated at is stated in Settings → Exchange rate and nowhere a reader
 * passes by accident.
 */

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

  return (
    <>
      <header className="sticky top-0 z-40 flex items-center gap-3.5 border-b-[1.5px] bg-(--sv-surface) px-[clamp(16px,2vw,24px)] py-3">
        {/* A narrow screen has no rail, so this opens the drawer. On a wide
            one the rail's own head carries its switch (1 Oct 2026). */}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
          className={cn(CHROME_BUTTON, "lg:hidden")}
        >
          <ListIcon weight="duotone" size={21} />
        </button>

        {/*
          Finance, then every level down to here.

          "Finance" is not a link: it names the product, and a link that goes
          nowhere in particular is what teaches people to stop trusting a
          breadcrumb. Everything between it and the last crumb is, because
          climbing one level is the whole reason this row exists. The last
          crumb is where you already are, so it stays plain.
        */}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex flex-wrap items-center gap-2 text-[14px]">
            <li className="font-medium text-(--sv-muted)">Finance</li>
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li
                  key={`${crumb.label}-${i}`}
                  className="flex min-w-0 items-center gap-2"
                >
                  <CaretRightIcon
                    weight="duotone"
                    size={13}
                    aria-hidden="true"
                    className="flex-none text-(--sv-muted)"
                  />
                  {crumb.href && !last ? (
                    <Link
                      href={crumb.href}
                      className="truncate font-medium text-(--sv-muted) underline-offset-2 transition-colors hover:text-(--sv-ink) hover:underline"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      aria-current={last ? "page" : undefined}
                      className={cn(
                        "truncate",
                        last
                          ? "font-extrabold text-(--sv-ink)"
                          : "font-medium text-(--sv-muted)",
                      )}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex flex-none items-center gap-2.5">
          <ThemeToggle />
          <NotificationBell />
        </div>
      </header>

      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
