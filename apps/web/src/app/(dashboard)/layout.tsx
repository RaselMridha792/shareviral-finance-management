import { redirect } from "next/navigation";

import { SessionProvider } from "@/components/auth/session-provider";
import { MainRegion } from "@/components/layout/main-region";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { RateProvider } from "@/components/money/rate-provider";
import { SettingsProvider } from "@/components/settings-provider";
import { ToastProvider } from "@/components/ui/toast";
import { getSession } from "@/lib/api-client";
import { settingsApi } from "@/lib/masters";
import { fxApi } from "@/lib/reports";

// The shell reflects who is signed in, so it can never be prerendered.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await getSession();

  // The proxy already redirects when the cookie is missing; this catches the
  // case where the cookie exists but the session is no longer valid.
  if (!user) redirect("/login");

  /**
   * Number format and financial year decide how every figure renders, so they
   * load once here rather than per page. The exchange rate joins them for the
   * same reason: every amount in the app now shows its dollar equivalent, so
   * the rate is needed wherever an amount is, which is everywhere.
   *
   * The rate is allowed to be missing. Nothing on the page breaks — the second
   * line simply is not drawn, which is the honest outcome when there is
   * nothing to convert at.
   */
  const [settings, rates] = await Promise.all([
    settingsApi.get(),
    fxApi.rates(1).catch(() => []),
  ]);

  return (
    <SessionProvider user={user}>
      <SettingsProvider settings={settings}>
        {/*
          Outside the layout rather than inside a page, so a toast raised just
          before a navigation survives it. Raised inside a page it would unmount
          with the page and the confirmation would flash and vanish.
        */}
        <RateProvider rate={rates[0]?.rate ?? null}>
          <ToastProvider>
            <div className="flex min-h-dvh">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <Topbar />
                <MainRegion>{children}</MainRegion>
              </div>
            </div>
          </ToastProvider>
        </RateProvider>
      </SettingsProvider>
    </SessionProvider>
  );
}
