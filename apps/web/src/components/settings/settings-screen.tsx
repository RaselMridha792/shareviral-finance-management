"use client";

import { hasPermission, type UserDto } from "@finance/shared";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import type { AppSettingsDto } from "@/components/settings-provider";
import type { CategoryNode } from "@/lib/masters";
import { AppearancePanel } from "./appearance-panel";
import { CategoriesPanel } from "./categories-panel";
import { CompanyPanel } from "./company-panel";
import { AuditPanel } from "./audit-panel";
import { EmailPanel } from "./email-panel";
import { NotificationsPanel } from "./notifications-panel";
import { SecurityPanel } from "./security-panel";
import { TaxPanel } from "./tax-panel";
import { TrashPanel } from "./trash-panel";
import { UsersPanel } from "./users-panel";
import { useCan, useSession } from "@/components/auth/session-provider";
import { settingsSectionFor } from "./sections";

/**
 * Settings, one section at a time.
 *
 * The sections are chosen in the rail (`layout/settings-nav.tsx`), not in a
 * row of tabs here — the September 2026 handoff gives Settings its own
 * sidebar. Which one is open is the URL's `?tab=`, so the rail and this screen
 * read the same value, a link can open a section directly, and Back returns to
 * the section before. The list of sections is `sections.ts`.
 */
export function SettingsScreen({
  initialSettings,
  initialTree,
  initialUsers,
}: {
  initialSettings: AppSettingsDto;
  initialTree: CategoryNode[];
  initialUsers: UserDto[];
}) {
  const role = useSession().role;
  const section = settingsSectionFor(
    useSearchParams().get("tab"),
    (entry) => !entry.permission || hasPermission(role, entry.permission),
  );
  const tab = section.id;
  const canManageUsers = useCan("users.manage");
  const canReadAudit = useCan("audit.read");
  const canWriteSettings = useCan("settings.write");
  const canReadTds = useCan("tds.read");

  return (
    <>
      <PageHeader
        eyebrow={`Settings · ${section.group}`}
        title={section.label}
        icon={section.icon}
        description={section.description}
      />

      {tab === "company" ? <CompanyPanel settings={initialSettings} /> : null}
      {tab === "appearance" && canWriteSettings ? (
        <AppearancePanel
          initial={{
            theme: initialSettings.theme ?? null,
            typography: initialSettings.typography ?? null,
          }}
        />
      ) : null}
      {tab === "categories" ? (
        <CategoriesPanel initialTree={initialTree} />
      ) : null}
      {/*
        No Exchange rate tab.

        The owner: "puro application er kono central or global currency rate ba
        fx rate rakhbona ... eta setting theke o remove kore diba". Every figure
        that used to be converted here is now either summed from the dollars the
        transactions themselves carry, or not shown in dollars at all — a rate
        set in one box that silently moved every historical report was the whole
        problem.

        The rate HISTORY table is not deleted. `fx_rates` holds figures the
        owner typed, on days that have passed, and throwing away recorded
        history to tidy a screen is not a trade this app makes. The table stays;
        nothing reads it to decide a figure any more.

        The PANEL is gone, on his word — "patata bad daw". `fx-panel.tsx` and
        `rate-history.tsx` sat in this folder with no route that opened them
        from the moment this tab was removed, which is worse than either having
        them or not: code nobody can reach is code nobody maintains and everyone
        still has to read.
      */}
      {tab === "tax" && canReadTds ? <TaxPanel /> : null}
      {tab === "security" ? <SecurityPanel /> : null}
      {tab === "users" && canManageUsers ? (
        <UsersPanel initialUsers={initialUsers} />
      ) : null}
      {tab === "audit" && canReadAudit ? <AuditPanel /> : null}
      {tab === "trashed" ? <TrashPanel /> : null}
      {/* No Assistant or Connections section: both are the Assistant's own
          settings now, behind the gear on its chat (B2, 3 Oct 2026), and
          `?tab=assistant` and `?tab=connections` open that page
          (app/(dashboard)/settings/page.tsx). */}
      {tab === "email" && canWriteSettings ? <EmailPanel /> : null}
      {tab === "notifications" && canWriteSettings ? (
        <NotificationsPanel />
      ) : null}
    </>
  );
}
