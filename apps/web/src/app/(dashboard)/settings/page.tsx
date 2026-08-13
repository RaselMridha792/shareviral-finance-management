import type { UserDto } from "@finance/shared";

import { SettingsScreen } from "@/components/settings/settings-screen";
import { getSession } from "@/lib/api-client";
import { categoriesApi, settingsApi } from "@/lib/masters";
import { usersApi } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · SFM" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // So a link from elsewhere can open the right panel rather than dropping
  // somebody on the first tab to find it themselves.
  const { tab } = await searchParams;
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
      initialTab={tab}
    />
  );
}
