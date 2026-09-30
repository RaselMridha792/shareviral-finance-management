"use client";

import { hasPermission, type Role } from "@finance/shared";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/ssr/SidebarSimple";
import { TrendUpIcon } from "@phosphor-icons/react/dist/ssr/TrendUp";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useId, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";
import { SettingsNav } from "@/components/layout/settings-nav";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import {
  RailCompactContext,
  toggleSidebar,
  useRailCompact,
  useSidebarCollapsed,
} from "@/components/layout/sidebar-state";
import { cn } from "@/lib/utils";
import { WaitingBadge } from "@/components/hr-requests/waiting-badge";

/**
 * The rail, as the September 2026 handoff draws it.
 *
 * A white panel with a hairline and a soft shadow on its right. Every row
 * carries its icon in a 32px tile; the row you are on turns violet — tint
 * behind it, white icon on a violet tile, a 5px violet bar at its left edge.
 *
 * Accounts and Expenses are accordions: the row opens the screens under it
 * rather than going anywhere itself, and the group holding the page you are on
 * starts open. That was the owner's ask before this design, and the handoff
 * draws the same thing — carets, children indented to 22px.
 *
 * HIDING LEAVES THE ICONS (1 Oct 2026). The handoff's toggle took the rail to
 * nothing; the owner asked for the words to go and the icons to stay, each
 * still a link: *"sidebar hide button a click korle sudhu lekha hide hobe
 * sidebar er icons jate dekha jay and click kore navigate ko kora jay"*. So
 * the rail is 270px or an 80px strip (`RailCompactContext`), and the button
 * that switches them is in the rail's own head now, beside the name, not in
 * the top bar: *"sidebar hide korar panel ta vitore dhukao"*. In the strip a
 * row is its tile, its name on hover; a parent that opens a list goes to its
 * first screen instead, since there is no room for the list.
 *
 * SETTINGS HAS ITS OWN RAIL. While /settings is open the main nav steps aside
 * for a way back and Settings' sections (`settings-nav.tsx`), which is where
 * the screen's row of tabs went. The brand and the footer stay.
 */

/** The handoff's width. */
const WIDTH = 270;
/** Icons only: a 32px tile, its 5px edge, and room either side. */
const COMPACT_WIDTH = 80;

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

/**
 * The row's shape, shared by links and the accordion parents.
 *
 * `sv-nav-row` (new-design.css) carries the 5px left edge and its violet when
 * active: a border colour written as a utility loses to globals.css's
 * unlayered `* { border-color }`, so it has to be plain CSS.
 */
function rowClass({
  active,
  sub,
  compact,
}: {
  active: boolean;
  sub?: boolean;
  compact?: boolean;
}) {
  return cn(
    "sv-nav-row flex w-full items-center gap-3 rounded-[11px] text-[15.5px] whitespace-nowrap",
    compact
      ? "justify-center py-1.5"
      : sub
        ? "py-[5px] pr-2.5 pl-[22px]"
        : "px-2.5 py-1.5",
    active ? "font-extrabold" : "font-bold",
  );
}

/** The strip's row: the tile, and HR Requests' count pinned to its corner. */
function CompactBody({ item }: { item: NavItem }) {
  return (
    <span className="relative">
      <Tile icon={item.icon} />
      {item.badge === "hr-requests-waiting" ? (
        <span className="absolute -top-2 -right-3 scale-90">
          <WaitingBadge />
        </span>
      ) : null}
    </span>
  );
}

function Tile({ icon: Glyph }: { icon: NavItem["icon"] }) {
  return (
    <span className="sv-nav-tile grid size-8 flex-none place-items-center rounded-lg">
      <Glyph weight="duotone" size={18} />
    </span>
  );
}

function NavRow({
  item,
  active,
  sub = false,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  /** A child of Accounts or Expenses, indented. */
  sub?: boolean;
  onNavigate?: () => void;
}) {
  const { href, label, comingSoon } = item;
  const compact = useRailCompact();

  const body = compact ? (
    <CompactBody item={item} />
  ) : (
    <>
      <Tile icon={item.icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {item.badge === "hr-requests-waiting" ? <WaitingBadge /> : null}
      {comingSoon ? (
        <span className="text-[10px] tracking-wide text-(--sv-muted) uppercase">
          soon
        </span>
      ) : null}
    </>
  );

  // No destination: a screen that does not exist yet. A label, not a link.
  if (comingSoon || !href) {
    return (
      <span
        className={cn(
          rowClass({ active: false, sub, compact }),
          "cursor-not-allowed opacity-45",
        )}
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
      data-active={active || undefined}
      className={rowClass({ active, sub, compact })}
      /* In the strip the name is not on the screen, so it is on the link. */
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
    >
      {body}
    </Link>
  );
}

/**
 * A parent that navigates nowhere: the row is a button that opens and closes
 * the list under it.
 *
 * Only the caret changes. Animating the panel's height would make every
 * navigation feel slower than it is, and this list is opened and closed more
 * often than anything else on the screen.
 */
function NavGroupRow({
  item,
  panelId,
  open,
  onToggle,
  holdsCurrentPage,
  activeHref,
  onNavigate,
}: {
  item: NavItem;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  holdsCurrentPage: boolean;
  activeHref: string | null;
  onNavigate?: () => void;
}) {
  // Closed but holding the page you are on: the parent wears the marker, so
  // the rail still answers "where am I" at a glance. Open, the child does.
  const wearsActive = holdsCurrentPage && !open;
  const Caret = open ? CaretDownIcon : CaretRightIcon;
  const compact = useRailCompact();

  /* In the strip there is no room for the list under a parent, so the
     parent goes to its first screen — Accounts to its overview, Payroll &
     Bank to Payroll — and wears the marker while any of its screens is
     open. */
  if (compact) {
    const first = (item.children ?? []).find((child) => child.href)?.href;
    if (!first) return null;
    return (
      <Link
        href={first}
        onClick={onNavigate}
        aria-label={item.label}
        title={item.label}
        aria-current={holdsCurrentPage ? "page" : undefined}
        data-active={holdsCurrentPage || undefined}
        className={rowClass({ active: holdsCurrentPage, compact })}
      >
        <CompactBody item={item} />
      </Link>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        data-active={wearsActive || undefined}
        className={cn(
          rowClass({ active: wearsActive }),
          "cursor-pointer text-left",
        )}
      >
        <Tile icon={item.icon} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <Caret
          weight="duotone"
          size={15}
          className="flex-none text-(--sv-muted)"
        />
      </button>

      <div id={panelId} className={cn("flex flex-col", !open && "hidden")}>
        {(item.children ?? []).map((child) => (
          <NavRow
            key={child.key}
            item={child}
            active={Boolean(child.href) && child.href === activeHref}
            sub
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The rail                                                                   */
/* -------------------------------------------------------------------------- */

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const compact = useRailCompact();
  const pathname = usePathname();
  const user = useSession();
  /**
   * Two copies of this component exist at once — the rail and the mobile
   * drawer — so the panel ids have to be unique per instance for
   * `aria-controls` to point at anything.
   */
  const uid = useId();

  /**
   * Only groups the reader has pressed land here.
   *
   * Everything else falls back to "open if it holds the page you are on",
   * which is what makes the rail arrive already showing where you are. Kept in
   * component state rather than storage: the desktop rail is never unmounted,
   * so a group stays as it was left for as long as the tab is open, and a
   * fresh visit starts from the page instead of from a stale preference.
   */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const activeHref = activeHrefFor(pathname);

  const holdsCurrentPage = (item: NavItem) =>
    (item.children ?? []).some((child) => child.href === activeHref);

  const renderItem = (item: NavItem) => {
    // A parent with children and no destination of its own is the accordion.
    if (item.children && !item.href) {
      const holds = holdsCurrentPage(item);
      return (
        <NavGroupRow
          key={item.key}
          item={item}
          panelId={`${uid}-${item.key}`}
          open={toggled[item.key] ?? holds}
          onToggle={() =>
            setToggled((current) => ({
              ...current,
              [item.key]: !(current[item.key] ?? holds),
            }))
          }
          holdsCurrentPage={holds}
          activeHref={activeHref}
          onNavigate={onNavigate}
        />
      );
    }

    return (
      <NavRow
        key={item.key}
        item={item}
        active={Boolean(item.href) && item.href === activeHref}
        onNavigate={onNavigate}
      />
    );
  };

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
       and the footer at the bottom; only the list between them moves. */
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "flex flex-none items-center border-b",
          compact
            ? "flex-col gap-2.5 px-2 py-3.5"
            : "gap-[11px] py-[18px] pr-3 pl-5",
        )}
      >
        <span className="grid size-10 flex-none place-items-center rounded-[11px] bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_6px_16px_rgb(150_200_0/0.3)]">
          <TrendUpIcon weight="duotone" size={23} />
        </span>
        {compact ? null : (
          <div className="min-w-0 flex-1 leading-[1.1]">
            <p className="text-[17px] font-extrabold tracking-[-0.02em] whitespace-nowrap">
              ShareViral
              {/* The owner: "ShareViral name tar opore dan pase choto kore
                  TM lekha thakbe". */}
              <sup
                className="ml-0.5 text-[8.5px] font-extrabold tracking-normal text-(--sv-muted)"
                data-trademark
              >
                TM
              </sup>
            </p>
            <p className="text-[10.5px] tracking-[0.16em] whitespace-nowrap text-(--sv-violet-ink) uppercase">
              Finance
            </p>
          </div>
        )}
        {/* The desktop rail's own switch; the mobile drawer closes itself. */}
        {onNavigate ? null : (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={
              compact ? "Show the menu's names" : "Hide the menu's names"
            }
            aria-pressed={compact}
            title={compact ? "Show the menu" : "Hide the menu"}
            className="grid size-8.5 flex-none cursor-pointer place-items-center rounded-lg text-(--sv-violet-ink) transition-colors hover:bg-(--sv-violet-tint)"
            data-rail-toggle
          >
            <SidebarSimpleIcon weight="duotone" size={19} />
          </button>
        )}
      </div>

      {underPath(pathname, "/settings") ? (
        // It reads `?tab=`; the boundary is what `useSearchParams` asks for.
        <Suspense fallback={<div className="flex-1" />}>
          <SettingsNav onNavigate={onNavigate} />
        </Suspense>
      ) : (
        <nav
          aria-label="Main"
          className={cn(
            "flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto pb-3.5",
            compact ? "px-2 pt-2" : "px-2.5 pt-1",
          )}
        >
          {groups.map((group, index) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              {compact ? (
                /* The group's name has no room; a hairline keeps the groups. */
                index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="mx-3 my-2 h-px bg-(--sv-line)"
                  />
                ) : null
              ) : (
                <p className="px-3 pt-4 pb-1.5 text-[11px] font-extrabold tracking-[0.14em] whitespace-nowrap text-(--sv-muted) uppercase">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => renderItem(item))}
            </div>
          ))}
        </nav>
      )}

      <SidebarFooter />
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSidebarCollapsed();
  const width = collapsed ? COMPACT_WIDTH : WIDTH;

  return (
    <aside
      className="sv-rail sticky top-0 hidden h-dvh flex-none self-start overflow-hidden border-r bg-(--sv-surface) lg:block"
      style={{ width }}
      data-compact={collapsed || undefined}
    >
      {/* Its own width, so the contents do not reflow while the rail slides. */}
      <div className="h-full" style={{ width }}>
        <RailCompactContext.Provider value={collapsed}>
          <SidebarContent />
        </RailCompactContext.Provider>
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
      <div
        className="absolute inset-y-0 left-0 bg-(--sv-surface)"
        style={{ width: WIDTH }}
      >
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}
