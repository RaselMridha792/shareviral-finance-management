"use client";

import { hasPermission, type Role } from "@finance/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/components/auth/session-provider";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { useSidebarCollapsed } from "@/components/layout/sidebar-state";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The rail is coloured by destination, not by section.
 *
 * One hue per item, carried on the row as a custom property and turned into a
 * colour by CSS — see `.nav-icon` in globals.css. It has to work that way
 * rather than as a class per item: fifteen hues written out as fifteen
 * Tailwind classes is fifteen chances for one of them to drift, and the hue is
 * data the design supplies rather than a decision made here.
 *
 * The active row drops the hue and takes the brand lime, filled.
 *
 * Sub-items are always visible, indented to 24px. They used to be an accordion
 * — a chevron, an open/closed state, a guide line — which hid two of the six
 * money screens behind a click and made the rail change height as you moved
 * around it. The design simply indents them.
 */

/** Width in the two states. The narrow one is icons only, centred. */
const FULL = 272;
const RAIL = 86;

/* -------------------------------------------------------------------------- */
/*  Which row is the current page                                              */
/* -------------------------------------------------------------------------- */

/** Every href in the rail, parents and children alike. */
const NAV_HREFS: string[] = (() => {
  const found: string[] = [];
  const walk = (items: NavItem[]) => {
    for (const item of items) {
      if (item.href) found.push(item.href);
      if (item.children) walk(item.children);
    }
  };
  for (const group of NAV_GROUPS) walk(group.items);
  walk(SECONDARY_NAV);
  return found;
})();

function underPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The longest matching href wins, so /expenses/other lights up "Other
 * expenses" rather than the "Expenses" whose prefix it shares — while
 * /expenses/technology still lights up Expenses.
 */
function activeHrefFor(pathname: string): string | null {
  let best: string | null = null;
  for (const href of NAV_HREFS) {
    if (!underPath(pathname, href)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/*  Permission filter                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hidden here, refused by the API independently — this is convenience, not the
 * security boundary.
 *
 * A parent that fails its own permission but still has visible children keeps
 * its row and loses its link. That is the case that matters: an HR user cannot
 * read the expense ledger but can see the subscriptions under it, and dropping
 * the parent outright would leave two indented rows under nothing.
 */
function visibleFor(role: Role | undefined, item: NavItem): NavItem | null {
  const allowed = !item.permission || hasPermission(role, item.permission);
  if (!item.children) return allowed ? item : null;

  const children = item.children
    .map((child) => visibleFor(role, child))
    .filter((child): child is NavItem => child !== null);

  if (allowed) return { ...item, children };
  if (children.length === 0) return null;
  return { ...item, href: undefined, children };
}

/* -------------------------------------------------------------------------- */
/*  Rows                                                                       */
/* -------------------------------------------------------------------------- */

/** 3px, inset, lime. The design's marker for where you are. */
function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 left-0 w-[3px] rounded-r-sm bg-sidebar-item-active"
    />
  );
}

function NavRow({
  item,
  active,
  indent = false,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  /** A sub-item: 24px in from the icon column, per the design. */
  indent?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { href, label, comingSoon } = item;

  const className = cn(
    "group relative flex w-full items-center rounded-[9px] py-[11px] text-[15px] transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none",
    collapsed ? "justify-center px-3" : "gap-3 pr-3",
    active
      ? "bg-sidebar-item-active-bg font-semibold text-sidebar-item-active"
      : "font-normal text-sidebar-item hover:bg-sidebar-item-active-bg/40 hover:text-foreground",
    comingSoon &&
      "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground",
  );

  const style = collapsed ? undefined : { paddingLeft: indent ? 24 : 12 };

  const body = (
    <>
      {active ? <ActiveBar /> : null}
      <Icon
        name={item.icon}
        size={21}
        fill={active}
        className="nav-icon shrink-0 transition-colors motion-reduce:transition-none"
        style={{ "--nav-hue": item.hue } as React.CSSProperties}
      />
      {/* Narrow: the name is gone from the screen, so it has to still be
          available to a screen reader and on hover — an unlabelled row of
          icons is a guessing game. */}
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
      {comingSoon && !collapsed ? (
        <span className="ml-auto text-[10px] tracking-wide text-muted-foreground uppercase">
          soon
        </span>
      ) : null}
    </>
  );

  // No destination: a parent whose children are the pages, or a screen that
  // does not exist yet. Either way it is a label, not a link.
  if (comingSoon || !href) {
    return (
      <span
        className={className}
        style={style}
        aria-disabled="true"
        title={label}
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      // Read by the stylesheet, which switches the icon off its hue and onto
      // the brand. A CSS-only swap, so nothing has to be threaded down.
      data-nav-active={active ? "true" : undefined}
      title={label}
      className={className}
      style={style}
    >
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  The rail                                                                   */
/* -------------------------------------------------------------------------- */

export function SidebarContent({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const user = useSession();

  const activeHref = activeHrefFor(pathname);

  // Imports and Settings are the SYSTEM section, in the flow with the rest —
  // not pinned to the bottom. The footer is what sits at the bottom.
  const groups = [...NAV_GROUPS, { title: "System", items: SECONDARY_NAV }]
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => visibleFor(user.role, item))
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((group) => group.items.length > 0);

  return (
    /* The nav is what scrolls, not the whole rail. The brand stays at the top
       and the footer at the bottom; only the list between them moves. Left to
       the column, a nav taller than the window was squeezed by flexbox instead
       — and, having no scroll of its own, spilled its last few rows straight
       over the footer. */
    <div className="flex h-full flex-col overflow-hidden pt-5 pb-[18px]">
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 pb-[22px]",
          collapsed ? "justify-center px-3" : "px-[18px]",
        )}
      >
        {/* The mark itself, not "SFM" set in a coloured box. The rounded
            square is part of the artwork, so it needs no container of its
            own. */}
        <BrandMark className="size-9 shrink-0" />
        {collapsed ? null : (
          <div className="flex min-w-0 flex-col leading-[1.25]">
            <span className="truncate text-base font-semibold tracking-[-0.01em] text-foreground">
              ShareViral
            </span>
            <span className="text-xs tracking-[0.07em] text-muted-foreground uppercase">
              Finance
            </span>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-[3px] overflow-x-hidden overflow-y-auto px-3">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-[3px]">
            {/* A heading has nowhere to go at this width. A rule keeps the
                grouping visible without pretending to be readable text. */}
            {collapsed ? (
              <div aria-hidden="true" className="mx-2.5 my-3 h-px bg-border" />
            ) : (
              <p className="px-2.5 pt-[18px] pb-2 text-[11px] font-semibold tracking-[0.13em] text-muted-foreground uppercase">
                {group.title}
              </p>
            )}

            {group.items.map((item) => (
              <div key={item.key} className="flex flex-col gap-[3px]">
                <NavRow
                  item={item}
                  active={Boolean(item.href) && item.href === activeHref}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                />
                {(item.children ?? []).map((child) => (
                  <NavRow
                    key={child.key}
                    item={child}
                    active={Boolean(child.href) && child.href === activeHref}
                    indent
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="shrink-0 pt-6">
        <SidebarFooter collapsed={collapsed} />
      </div>
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSidebarCollapsed();

  return (
    <aside
      // Pure black in dark, light grey in light — the rail is the one surface
      // that does not follow the card ladder, and the design gives it no
      // border: the change of ground is the edge.
      className="hidden shrink-0 bg-sidebar transition-[width] duration-200 lg:block motion-reduce:transition-none"
      style={{ width: collapsed ? RAIL : FULL }}
    >
      <div className="sticky top-0 h-dvh">
        <SidebarContent collapsed={collapsed} />
      </div>
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className="absolute inset-0 bg-black/55"
      />
      <div className="absolute inset-y-0 left-0 w-[282px] bg-sidebar">
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}
