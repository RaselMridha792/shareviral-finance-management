"use client";

import type { UserDto } from "@finance/shared";
import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import type { AppSettingsDto } from "@/components/settings-provider";
import type { CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { CategoriesPanel } from "./categories-panel";
import { CompanyPanel } from "./company-panel";
import { AssistantPanel } from "./assistant-panel";
import { AuditPanel } from "./audit-panel";
import { EmailPanel } from "./email-panel";
import { NotificationsPanel } from "./notifications-panel";
import { SecurityPanel } from "./security-panel";
import { TaxPanel } from "./tax-panel";
import { TrashPanel } from "./trash-panel";
import { UsersPanel } from "./users-panel";
import { useCan } from "@/components/auth/session-provider";

const TABS = [
  { id: "company", label: "Company & formatting" },
  { id: "categories", label: "Categories" },
  // Readable by anyone who can see the tax screens; only settings.write may
  // save. The calculator is the reason it is not settings-only — checking a
  // figure against the accountant's working is not an administrative act.
  { id: "tax", label: "Salary TDS", permission: "tds.read" },
  // No permission. This is your own account's second factor, not an
  // administrator's view of anybody else's — there is nothing here that could
  // be gated, because everyone has exactly one account to look after.
  { id: "security", label: "Your sign-in" },
  // Creating an account is the ability to grant any permission in the app, so
  // this tab is Super Admin only — and the API refuses everyone else anyway.
  { id: "users", label: "People who can sign in", permission: "users.manage" },
  { id: "audit", label: "What changed", permission: "audit.read" },
  /*
   * Everything anybody deleted, waiting to be restored or purged. Gated the
   * way the screen itself is — reachable with settings.read — because the API
   * already narrows what it lists to the kinds this role could have deleted,
   * and a person who deleted a row on some other screen must be able to reach
   * the place it went without a permission they never needed to delete it.
   */
  { id: "trashed", label: "Trashed" },
  { id: "assistant", label: "Assistant", permission: "settings.write" },
  { id: "email", label: "Email", permission: "settings.write" },
  {
    id: "notifications",
    label: "Notifications",
    permission: "settings.write",
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsScreen({
  initialSettings,
  initialTree,
  initialUsers,
  initialTab,
}: {
  initialSettings: AppSettingsDto;
  initialTree: CategoryNode[];
  initialUsers: UserDto[];
  initialTab?: string;
}) {
  const [tab, setTab] = useState<TabId>(
    TABS.some((entry) => entry.id === initialTab)
      ? (initialTab as TabId)
      : "company",
  );
  const canManageUsers = useCan("users.manage");
  const canReadAudit = useCan("audit.read");
  const canWriteSettings = useCan("settings.write");
  const canReadTds = useCan("tds.read");
  const allowed: Record<string, boolean> = {
    "users.manage": canManageUsers,
    "audit.read": canReadAudit,
    "settings.write": canWriteSettings,
    "tds.read": canReadTds,
  };
  const tabs = TABS.filter(
    (entry) => !("permission" in entry) || allowed[entry.permission],
  );

  return (
    <>
      <PageHeader
        title="Settings"
        icon="settings"
        description="Company details, how figures are shown, categories, and the USD rate."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="tabs-scroll flex gap-1 border-b border-border"
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === entry.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "company" ? <CompanyPanel settings={initialSettings} /> : null}
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
      {tab === "assistant" && canWriteSettings ? <AssistantPanel /> : null}
      {tab === "email" && canWriteSettings ? <EmailPanel /> : null}
      {tab === "notifications" && canWriteSettings ? (
        <NotificationsPanel />
      ) : null}
    </>
  );
}
