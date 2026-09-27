import type { UserDto } from "@finance/shared";

import { SettingsScreen } from "@/components/settings/settings-screen";
import { getSession } from "@/lib/api-client";
import { categoriesApi, settingsApi } from "@/lib/masters";
import { usersApi } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · SFM" };

// Which section is open is the URL's `?tab=`, read on the client by the
// screen and the Settings rail alike — so a link from elsewhere opens the
// right panel rather than dropping somebody on the first to find it.
export default async function SettingsPage() {
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
