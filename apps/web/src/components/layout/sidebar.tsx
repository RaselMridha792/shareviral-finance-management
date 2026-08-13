"use client";

import { hasPermission } from "@finance/shared";
import { X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "@/components/auth/session-provider";
import {
  NAV_GROUPS,
  SECONDARY_NAV,
  type NavItem,
} from "@/components/layout/nav-items";
import { cn } from "@/lib/utils";

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { href, label, icon: Icon, comingSoon } = item;

  const className = cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
    active
      ? "bg-primary/10 text-primary"
      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
    comingSoon && "cursor-not-allowed opacity-45 hover:bg-transparent",
  );

  const body = (
    <>
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
      {comingSoon ? (
        <span className="ml-auto text-[10px] tracking-wide text-muted-foreground uppercase">
          soon
        </span>
      ) : null}
    </>
  );

  if (comingSoon) {
    return (
      <span className={className} aria-disabled="true" title="Not built yet">
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

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useSession();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // Hidden here, refused by the API independently — this is convenience, not
  // the security boundary.
  const visible = (item: NavItem) => hasPermission(user.role, item.permission);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(visible),
  })).filter((group) => group.items.length > 0);

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
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-1 pt-4">
          {SECONDARY_NAV.filter(visible).map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
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
      <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">
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
