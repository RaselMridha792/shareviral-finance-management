import type { UserDto } from "@finance/shared";
import { permanentRedirect } from "next/navigation";

import { SettingsScreen } from "@/components/settings/settings-screen";
import { getSession } from "@/lib/api-client";
import { categoriesApi, settingsApi } from "@/lib/masters";
import { usersApi } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · SFM" };

/**
 * The sections that moved to the Assistant's own settings (B2, 3 Oct 2026).
 * Their old addresses still answer — a link in SESSIONS, a bookmark, a
 * sentence an older API still says — with the page they became.
 */
const MOVED: Record<string, string> = {
  assistant: "/assistant/settings",
  connections: "/assistant/settings",
};

// Which section is open is the URL's `?tab=`, read on the client by the
// screen and the Settings rail alike — so a link from elsewhere opens the
// right panel rather than dropping somebody on the first to find it.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  if (typeof tab === "string" && Object.hasOwn(MOVED, tab)) {
    permanentRedirect(MOVED[tab]);
  }

  const session = await getSession();
  // Anyone else gets a 403 from this endpoint, which would take the page down.
  const canManageUsers = session?.permissions.includes("users.manage") ?? false;

  const [settings, categories, users] = await Promise.all([
    settingsApi.get(),
    categoriesApi.tree(true),
    canManageUsers
      ? usersApi.list().then((page) => page.items)
      : Promise.resolve([] as UserDto[]),
  ]);

  return (
    <SettingsScreen
      initialSettings={settings}
      initialTree={categories}
      initialUsers={users}
    />
  );
}
