import { SettingsScreen } from "@/components/settings/settings-screen";
import { categoriesApi, settingsApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · SFM" };

export default async function SettingsPage() {
  const [settings, categories] = await Promise.all([
    settingsApi.get(),
    categoriesApi.tree(true),
  ]);

  return <SettingsScreen initialSettings={settings} initialTree={categories} />;
}
