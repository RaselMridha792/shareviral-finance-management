"use client";

import { hasPermission, type Role } from "@finance/shared";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { TrendUpIcon } from "@phosphor-icons/react/dist/ssr/TrendUp";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";
import { SidebarFooter } from "@/components/layout/sidebar-footer";
import { useSidebarCollapsed } from "@/components/layout/sidebar-state";
import { cn } from "@/lib/utils";

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
 * NARROWING IS HIDING NOW. The August design folded the rail to an 84px strip
 * of icons; the handoff's toggle takes it to nothing, and the content gets the
 * width. So there is one rail, 270px or gone — which also retired the icons-only
 * branch of every row, and the "widen first, then open" dance a parent needed
 * in the strip.
 */

/** The handoff's width. */
const WIDTH = 270;

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
function rowClass({ active, sub }: { active: boolean; sub?: boolean }) {
  return cn(
    "sv-nav-row flex w-full items-center gap-3 rounded-[11px] text-[15.5px] whitespace-nowrap",
    sub ? "py-[5px] pr-2.5 pl-[22px]" : "px-2.5 py-1.5",
    active ? "font-extrabold" : "font-bold",
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

  const body = (
    <>
      <Tile icon={item.icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
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
          rowClass({ active: false, sub }),
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
      className={rowClass({ active, sub })}
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
      <div className="flex flex-none items-center gap-[11px] border-b px-5 py-[18px]">
        <span className="grid size-10 flex-none place-items-center rounded-[11px] bg-(--sv-accent) text-(--sv-on-accent) shadow-[0_6px_16px_rgb(150_200_0/0.3)]">
          <TrendUpIcon weight="duotone" size={23} />
        </span>
        <div className="min-w-0 leading-[1.1]">
          <p className="text-[17px] font-extrabold tracking-[-0.02em] whitespace-nowrap">
            ShareViral
          </p>
          <p className="text-[10.5px] tracking-[0.16em] whitespace-nowrap text-(--sv-violet-ink) uppercase">
            Finance
          </p>
        </div>
      </div>

      <nav
        aria-label="Main"
        className="flex flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2.5 pt-1 pb-3.5"
      >
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <p className="px-3 pt-4 pb-1.5 text-[11px] font-extrabold tracking-[0.14em] whitespace-nowrap text-(--sv-muted) uppercase">
              {group.title}
            </p>
            {group.items.map((item) => renderItem(item))}
          </div>
        ))}
      </nav>

      <SidebarFooter />
    </div>
  );
}

export function Sidebar() {
  const collapsed = useSidebarCollapsed();

  return (
    <aside
      // Hidden, not merely narrow: `inert` takes the links out of the tab
      // order too, or a keyboard would walk through a rail nobody can see.
      inert={collapsed}
      aria-hidden={collapsed || undefined}
      className="sv-rail sticky top-0 hidden h-dvh flex-none self-start overflow-hidden border-r bg-(--sv-surface) lg:block"
      style={{ width: collapsed ? 0 : WIDTH }}
    >
      {/* Its own width, so the contents do not reflow while the rail slides. */}
      <div className="h-full" style={{ width: WIDTH }}>
        <SidebarContent />
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
