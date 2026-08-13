"use client";

import { hasPermission, type Role } from "@finance/shared";
import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { useSession } from "@/components/auth/session-provider";
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
  { active, depth }: { active: boolean; depth: number },
) {
  return cn(
    "group relative flex w-full items-center rounded-lg px-3 transition-colors outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none",
    depth === 0 ? "gap-3 py-2 text-sm" : "gap-2.5 py-1.5 text-[13px]",
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
  onNavigate,
}: {
  item: NavItem;
  accent: NavAccent;
  active: boolean;
  depth?: number;
  onNavigate?: () => void;
}) {
  const { href, label, comingSoon } = item;

  const className = cn(
    rowClass(accent, { active, depth }),
    comingSoon &&
      "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground",
  );

  const body = (
    <>
      {active ? <ActiveBar accent={accent} /> : null}
      <NavIcon item={item} accent={accent} lit={active} />
      <span className="truncate">{label}</span>
      {comingSoon ? (
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
        title={comingSoon ? "Not built yet" : undefined}
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
  onNavigate,
}: {
  item: NavItem;
  accent: NavAccent;
  panelId: string;
  open: boolean;
  onToggle: () => void;
  holdsCurrentPage: boolean;
  activeHref: string | null;
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
        className={cn(
          rowClass(accent, { active: wearsActive, depth: 0 }),
          "cursor-pointer text-left",
          holdsCurrentPage && "font-semibold text-foreground",
        )}
      >
        {wearsActive ? <ActiveBar accent={accent} /> : null}
        <NavIcon item={item} accent={accent} lit={holdsCurrentPage} />
        <span className="truncate">{item.label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      </button>

      <NavChildren
        id={panelId}
        item={item}
        accent={accent}
        activeHref={activeHref}
        hidden={!open}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The rail                                                                   */
/* -------------------------------------------------------------------------- */

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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

    // A parent that is itself a page keeps its link and shows its children
    // under it — Accounts must stay reachable.
    if (item.children) {
      return (
        <div key={item.key} className="flex flex-col">
          <NavLink
            item={item}
            accent={accent}
            active={item.href === activeHref}
            onNavigate={onNavigate}
          />
          <NavChildren
            id={`${uid}-${item.key}`}
            item={item}
            accent={accent}
            activeHref={activeHref}
            onNavigate={onNavigate}
          />
        </div>
      );
    }

    return (
      <NavLink
        key={item.key}
        item={item}
        accent={accent}
        active={item.href === activeHref}
        onNavigate={onNavigate}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground">
          SFM
        </span>
        <span className="truncate text-[15px] font-semibold tracking-tight">
          ShareViral Finance
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.title}
            </p>
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

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
      <div className="sticky top-0 h-dvh">
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
