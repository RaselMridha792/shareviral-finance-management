"use client";

import { ROLE_LABELS } from "@finance/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { Icon } from "@/components/ui/icon";
import { logout } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Who is signed in, at the foot of the rail.
 *
 * It used to sit in the top bar, which put the least-used control on every
 * screen in the most prominent place. Down here it is out of the way and still
 * always reachable — and the top bar gets the space back for the breadcrumb and
 * the rate, which are things somebody actually reads.
 *
 * In rail mode only the avatar and the sign-out remain, stacked.
 */
export function SidebarFooter({ collapsed = false }: { collapsed?: boolean }) {
  const user = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  // Letters only: a name like "HR (test)" must not render as "H(".
  const initials =
    user.fullName
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || user.email[0].toUpperCase();

  return (
    <div
      className={cn(
        "mx-3 flex items-center gap-[11px] border-t border-border px-2.5 pt-3.5 pb-1",
        collapsed && "flex-col gap-2",
      )}
    >
      <span
        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-sidebar-item-active"
        title={
          collapsed ? `${user.fullName} — ${ROLE_LABELS[user.role]}` : undefined
        }
      >
        {initials}
      </span>

      {collapsed ? null : (
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-foreground">
            {user.fullName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {ROLE_LABELS[user.role]}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
      >
        <Icon name="logout" size={18} />
      </button>
    </div>
  );
}
