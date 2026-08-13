"use client";

import { hasPermission, type Permission } from "@finance/shared";
import { createContext, useContext, type ReactNode } from "react";

import type { SessionUser } from "@/lib/api-client";

const SessionContext = createContext<SessionUser | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) {
    throw new Error("useSession must be used inside a signed-in layout");
  }
  return user;
}

/**
 * Whether the signed-in user may do something.
 *
 * This only hides UI. The API refuses the same thing independently — the guard
 * there is the real boundary, this is the convenience on top of it.
 */
export function useCan(permission: Permission): boolean {
  const user = useContext(SessionContext);
  return hasPermission(user?.role, permission);
}
