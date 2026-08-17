"use client";

import { ROLE_LABELS } from "@finance/shared";
import { LogOut, Menu } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/components/auth/session-provider";
import { MobileSidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { logout } from "@/lib/api-client";

export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const user = useSession();
  const router = useRouter();

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  // Only letters: a name like "HR (test)" must not render as "H(".
  const initials =
    user.fullName
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || user.email[0].toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md sm:px-6">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
          className="cursor-pointer rounded-lg p-2 text-muted-foreground hover:bg-surface-muted lg:hidden"
        >
          <Menu className="size-5" />
        </button>

        {/*
          There was a search box here, permanently `disabled`, searching
          nothing. It came from the scaffold and never got wired up — greyed
          out, but a search box all the same, in the most prominent place on
          every screen. A control that cannot do the thing it depicts is worse
          than no control: people try it, nothing happens, and they learn not
          to trust the chrome.

          Every screen that has something to search has its own search box on
          it. If a global one is ever built it belongs here, working.
        */}
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />

          <div className="flex items-center gap-2.5 pl-1">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
              {initials}
            </span>
            <div className="hidden leading-tight sm:block">
              <p className="max-w-[13ch] truncate text-sm font-medium">
                {user.fullName}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
