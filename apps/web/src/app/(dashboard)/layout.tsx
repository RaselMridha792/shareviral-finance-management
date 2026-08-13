import { redirect } from "next/navigation";

import { SessionProvider } from "@/components/auth/session-provider";
import { MainRegion } from "@/components/layout/main-region";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SettingsProvider } from "@/components/settings-provider";
import { getSession } from "@/lib/api-client";
import { settingsApi } from "@/lib/masters";

// The shell reflects who is signed in, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await getSession();

  // The proxy already redirects when the cookie is missing; this catches the
  // case where the cookie exists but the session is no longer valid.
  if (!user) redirect("/login");

  // Number format and financial year decide how every figure renders, so they
  // load once here rather than per page.
  const settings = await settingsApi.get();

  return (
    <SessionProvider user={user}>
      <SettingsProvider settings={settings}>
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <MainRegion>{children}</MainRegion>
          </div>
        </div>
      </SettingsProvider>
    </SessionProvider>
  );
}
