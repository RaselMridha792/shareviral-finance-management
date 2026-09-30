"use client";

import { ROLE_LABELS } from "@finance/shared";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { useRailCompact } from "@/components/layout/sidebar-state";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/api-client";

/**
 * Who is signed in, at the foot of the rail.
 *
 * It used to sit in the top bar, which put the least-used control on every
 * screen in the most prominent place. Down here it is out of the way and still
 * always reachable — and the top bar gets the space back for the breadcrumb,
 * which is something somebody actually reads.
 *
 * The handoff draws it as a violet card: a lime avatar with the initials, the
 * name over the sign-in address, and the way out. The role is not printed —
 * the handoff has the address there — so it rides on the avatar's tooltip.
 */
export function SidebarFooter() {
  const user = useSession();
  const router = useRouter();
  /* The icons-only rail: the initials and the door, one above the other. */
  const compact = useRailCompact();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      // The reason is only for the sign-in page's "You have signed out." line.
      router.replace("/login?reason=signed-out");
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
        "sv-user-card mb-3 flex flex-none items-center rounded-[11px] bg-(--sv-violet-tint)",
        compact ? "mx-2 flex-col gap-2 p-2" : "mx-2.5 gap-[11px] p-3",
      )}
    >
      <span
        className="grid size-[38px] flex-none place-items-center rounded-full bg-(--sv-accent) text-[13px] font-extrabold text-(--sv-on-accent)"
        title={`${user.fullName} — ${ROLE_LABELS[user.role]}`}
      >
        {initials}
      </span>

      {compact ? null : (
        <div className="min-w-0 flex-1 leading-[1.25]">
          <p className="truncate text-[14px] font-extrabold">{user.fullName}</p>
          <p className="truncate text-[12px] text-(--sv-muted)">{user.email}</p>
        </div>
      )}

      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-[34px] flex-none cursor-pointer place-items-center rounded-lg text-(--sv-violet-ink) transition-colors hover:bg-(--sv-surface) disabled:opacity-50"
      >
        <SignOutIcon weight="duotone" size={19} />
      </button>
    </div>
  );
}
