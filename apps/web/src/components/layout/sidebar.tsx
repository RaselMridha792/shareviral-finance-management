"use client";

import { hasPermission, type Role } from "@finance/shared";
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { BrandMark } from "@/components/layout/brand-mark";
import {
  NAV_GROUPS,
  SECONDARY_ACCENT,
  SECONDARY_NAV,
  type NavAccent,
  type NavItem,
} from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

/**
 * Section colour, written out in full.
 *
 * Tailwind scans source text for class names, so `text-chart-${accent}` would
 * produce nothing. Every class here is a literal, and every colour is a token
 * from globals.css — the dark theme swaps the token, not this file.
 *
 * Colour sits on the icon, never as a wash behind the whole row: if every row
 * is tinted, the one you are on stops standing out.
 */
const ACCENT: Record<
  NavAccent,
  { icon: string; activeIcon: string; activeRow: string; bar: string }
> = {
  "chart-1": {
    icon: "text-chart-1/70 group-hover:text-chart-1",
    activeIcon: "text-chart-1",
    activeRow: "bg-chart-1/10 inset-ring-1 inset-ring-chart-1/25",
    bar: "bg-chart-1",
  },
  "chart-2": {
    icon: "text-chart-2/70 group-hover:text-chart-2",
    activeIcon: "text-chart-2",
    activeRow: "bg-chart-2/10 inset-ring-1 inset-ring-chart-2/25",
    bar: "bg-chart-2",
  },
  "chart-3": {
    icon: "text-chart-3/70 group-hover:text-chart-3",
    activeIcon: "text-chart-3",
    activeRow: "bg-chart-3/10 inset-ring-1 inset-ring-chart-3/25",
    bar: "bg-chart-3",
  },
  "chart-4": {
    icon: "text-chart-4/70 group-hover:text-chart-4",
    activeIcon: "text-chart-4",
    activeRow: "bg-chart-4/10 inset-ring-1 inset-ring-chart-4/25",
    bar: "bg-chart-4",
  },
  "chart-5": {
    icon: "text-chart-5/70 group-hover:text-chart-5",
    activeIcon: "text-chart-5",
    activeRow: "bg-chart-5/10 inset-ring-1 inset-ring-chart-5/25",
    bar: "bg-chart-5",
  },
  "chart-6": {
    icon: "text-chart-6/70 group-hover:text-chart-6",
    activeIcon: "text-chart-6",
    activeRow: "bg-chart-6/10 inset-ring-1 inset-ring-chart-6/25",
    bar: "bg-chart-6",
  },
};

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
 * expenses" rather than the "Overview" whose /expenses prefix it shares —
 * while /expenses/technology still lights up Overview.
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
 * A child is filtered by its own permission. A parent is a door to its
 * children, so it disappears once none of them are left: an HR user keeps
 * Expenses purely because "AI tools and subscriptions" survives.
 */
function visibleFor(role: Role | undefined, item: NavItem): NavItem | null {
  if (item.permission && !hasPermission(role, item.permission)) return null;
  if (!item.children) return item;

  const children = item.children
    .map((child) => visibleFor(role, child))
    .filter((child): child is NavItem => child !== null);
  if (children.length === 0) return null;

  return { ...item, children };
}

/* -------------------------------------------------------------------------- */
/*  Rows                                                                       */
/* -------------------------------------------------------------------------- */

function rowClass(
  accent: NavAccent,
  {
    active,
    depth,
    collapsed,
  }: { active: boolean; depth: number; collapsed?: boolean },
) {
  return cn(
    "group relative flex w-full items-center rounded-lg transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none",
    // Narrow: the icon is the whole row, so it is centred and the padding
    // that made room for a label goes away.
    collapsed ? "justify-center px-0 py-2" : "px-3",
    collapsed
      ? null
      : depth === 0
        ? "gap-3 py-2 text-sm"
        : "gap-2.5 py-1.5 text-[13px]",
    active
      ? // A filled pill, a hairline of the same colour, a left bar and a
        // heavier weight. Hover below is deliberately a step quieter.
        cn("font-semibold text-foreground", ACCENT[accent].activeRow)
      : "font-medium text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  );
}

function ActiveBar({ accent }: { accent: NavAccent }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-1.5 bottom-1.5 left-0 w-1 rounded-r-full",
        ACCENT[accent].bar,
      )}
    />
  );
}

function NavIcon({
  item,
  accent,
  lit,
}: {
  item: NavItem;
  accent: NavAccent;
  lit: boolean;
}) {
  const Icon = item.icon;
  return (
    <Icon
      className={cn(
        "size-4 shrink-0 transition-colors motion-reduce:transition-none",
        lit ? ACCENT[accent].activeIcon : ACCENT[accent].icon,
      )}
    />
  );
}

function NavLink({
  item,
  accent,
  active,
  depth = 0,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  accent: NavAccent;
  active: boolean;
  depth?: number;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { href, label, comingSoon } = item;

  const className = cn(
    rowClass(accent, { active, depth, collapsed }),
    comingSoon &&
      "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground",
  );

  const body = (
    <>
      {active ? <ActiveBar accent={accent} /> : null}
      <NavIcon item={item} accent={accent} lit={active} />
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

  if (comingSoon || !href) {
    return (
      <span
        className={className}
        aria-disabled="true"
        title={
          comingSoon ? `${label} — not built yet` : collapsed ? label : undefined
        }
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
      title={collapsed ? label : undefined}
      className={className}
    >
      {body}
    </Link>
  );
}

/** The children of a parent, indented against a guide line. */
function NavChildren({
  id,
  item,
  accent,
  activeHref,
  hidden,
  onNavigate,
}: {
  id: string;
  item: NavItem;
  accent: NavAccent;
  activeHref: string | null;
  hidden?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div
      id={id}
      className={cn(
        "mt-1 ml-2 flex flex-col gap-1 border-l border-border pl-2",
        hidden && "hidden",
      )}
    >
      {(item.children ?? []).map((child) => (
        <NavLink
          key={child.key}
          item={child}
          accent={accent}
          active={Boolean(child.href) && child.href === activeHref}
          depth={1}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

/**
 * A parent that navigates nowhere: the row is a real button that opens and
 * closes the list under it. Only the chevron moves — animating the height of
 * the panel would make every navigation feel slower than it is.
 */
function NavSection({
  item,
  accent,
  panelId,
  open,
  onToggle,
  holdsCurrentPage,
  activeHref,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  accent: NavAccent;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  holdsCurrentPage: boolean;
  activeHref: string | null;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  // Closed but holding the page you are on: the parent takes the pill so the
  // rail still answers "where am I" at a glance. Open, the child answers it.
  const wearsActive = holdsCurrentPage && !open;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        title={collapsed ? item.label : undefined}
        className={cn(
          rowClass(accent, { active: wearsActive, depth: 0, collapsed }),
          "cursor-pointer text-left",
          holdsCurrentPage && "font-semibold text-foreground",
        )}
      >
        {wearsActive ? <ActiveBar accent={accent} /> : null}
        <NavIcon item={item} accent={accent} lit={holdsCurrentPage} />
        {collapsed ? (
          <span className="sr-only">{item.label}</span>
        ) : (
          <>
            <span className="truncate">{item.label}</span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </>
        )}
      </button>

      {/* There is nowhere to put an indented list sixteen pixels wide, so in
          the narrow rail pressing the parent widens the rail and opens it.
          The alternative — a flyout — is a second navigation to build and
          keep working, for a case that is one click from the real one. */}
      {collapsed ? null : (
        <NavChildren
          id={panelId}
          item={item}
          accent={accent}
          activeHref={activeHref}
          hidden={!open}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The rail                                                                   */
/* -------------------------------------------------------------------------- */

export function SidebarContent({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const user = useSession();
  // Two copies of this component exist at once (rail + drawer), so the panel
  // ids have to be unique per instance for aria-controls to mean anything.
  const uid = useId();

  // Only rows the reader has toggled by hand land here; everything else falls
  // back to "open if it holds the current page". Kept in component state so a
  // section stays as it was left across navigations, without a storage
  // dependency — the desktop rail is never unmounted.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const activeHref = activeHrefFor(pathname);

  const holdsCurrentPage = (item: NavItem) =>
    (item.children ?? []).some((child) => child.href === activeHref);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .map((item) => visibleFor(user.role, item))
      .filter((item): item is NavItem => item !== null),
  })).filter((group) => group.items.length > 0);

  const secondary = SECONDARY_NAV.map((item) =>
    visibleFor(user.role, item),
  ).filter((item): item is NavItem => item !== null);

  const renderItem = (item: NavItem, accent: NavAccent) => {
    const holds = holdsCurrentPage(item);

    // A parent with children and no destination of its own is the accordion.
    if (item.children && !item.href) {
      return (
        <NavSection
          key={item.key}
          item={item}
          accent={accent}
          panelId={`${uid}-${item.key}`}
          open={toggled[item.key] ?? holds}
          collapsed={collapsed}
          onToggle={() => {
            // Narrow: widen first, then open the section — otherwise the
            // press appears to do nothing at all.
            if (collapsed) {
              onToggleCollapsed?.();
              setToggled((current) => ({ ...current, [item.key]: true }));
              return;
            }
            setToggled((current) => ({
              ...current,
              [item.key]: !(current[item.key] ?? holds),
            }));
          }}
          holdsCurrentPage={holds}
          activeHref={activeHref}
          onNavigate={onNavigate}
        />
      );
    }

    // A parent that is itself a page keeps its link and shows its children
    // under it — Accounts must stay reachable.
    if (item.children) {
      return (
        <div key={item.key} className="flex flex-col">
          <NavLink
            item={item}
            accent={accent}
            active={item.href === activeHref}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          {collapsed ? null : (
            <NavChildren
              id={`${uid}-${item.key}`}
              item={item}
              accent={accent}
              activeHref={activeHref}
              onNavigate={onNavigate}
            />
          )}
        </div>
      );
    }

    return (
      <NavLink
        key={item.key}
        item={item}
        accent={accent}
        active={item.href === activeHref}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        {/* The mark itself, not "SFM" set in a coloured box. The rounded
            square is part of the artwork, so it needs no container of its
            own. */}
        <BrandMark className="size-8 shrink-0" />
        {collapsed ? null : (
          <>
            <span className="truncate text-[15px] font-semibold tracking-tight">
              ShareViral Finance
            </span>
            {onToggleCollapsed ? (
              <CollapseButton collapsed={false} onClick={onToggleCollapsed} />
            ) : null}
          </>
        )}
      </div>

      {/* Narrow, the button moves below the mark: there is no room beside it,
          and it has to stay on screen or the rail cannot be widened again. */}
      {collapsed && onToggleCollapsed ? (
        <div className="flex justify-center pb-2">
          <CollapseButton collapsed onClick={onToggleCollapsed} />
        </div>
      ) : null}

      <nav
        className={cn(
          "flex flex-1 flex-col gap-1 overflow-y-auto pb-4",
          collapsed ? "px-2" : "px-3",
        )}
      >
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            {/* A heading has nowhere to go at this width. A rule keeps the
                grouping visible without pretending to be readable text. */}
            {collapsed ? (
              <div
                aria-hidden="true"
                className="mx-2 mt-3 mb-1.5 border-t border-border"
              />
            ) : (
              <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group.title}
              </p>
            )}
            {group.items.map((item) => renderItem(item, group.accent))}
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-1 pt-4">
          {secondary.map((item) => renderItem(item, SECONDARY_ACCENT))}
        </div>
      </nav>
    </div>
  );
}

/** The one control that narrows and widens the rail. */
function CollapseButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  const label = collapsed ? "Widen the sidebar" : "Narrow the sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={collapsed}
      title={label}
      className={cn(
        "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none",
        collapsed ? null : "ml-auto",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** Remembered, so the choice survives a reload rather than being made daily. */
const COLLAPSED_KEY = "sfm.sidebar.collapsed";

export function Sidebar() {
  /**
   * Starts wide, then corrects itself on mount.
   *
   * The server has no way to know what this browser last chose, so rendering
   * the remembered width straight away would mean the server and the client
   * disagreeing about the markup — which React treats as an error and which
   * shows up as the whole shell being thrown away and rebuilt. Reading the
   * preference in an effect costs one frame at the old width and is correct.
   */
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Private browsing, or storage full. The rail still works for this
        // visit; only the remembering is lost.
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "hidden shrink-0 border-r border-border bg-surface transition-[width] duration-200 lg:block motion-reduce:transition-none",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="sticky top-0 h-dvh">
        <SidebarContent collapsed={collapsed} onToggleCollapsed={toggle} />
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
        className="absolute inset-0 bg-black/50"
      />
      <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute top-4 right-3 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted"
        >
          <X className="size-4" />
        </button>
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}
