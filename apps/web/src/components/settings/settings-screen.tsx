"use client";

import type { UserDto } from "@finance/shared";
import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import type { AppSettingsDto } from "@/components/settings-provider";
import type { CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { CategoriesPanel } from "./categories-panel";
import { CompanyPanel } from "./company-panel";
import { FxPanel } from "./fx-panel";
import { AssistantPanel } from "./assistant-panel";
import { AuditPanel } from "./audit-panel";
import { UsersPanel } from "./users-panel";
import { useCan } from "@/components/auth/session-provider";

const TABS = [
  { id: "company", label: "Company & formatting" },
  { id: "categories", label: "Categories" },
  { id: "fx", label: "Exchange rate" },
  // Creating an account is the ability to grant any permission in the app, so
  // this tab is Super Admin only — and the API refuses everyone else anyway.
  { id: "users", label: "People who can sign in", permission: "users.manage" },
  { id: "audit", label: "What changed", permission: "audit.read" },
  { id: "assistant", label: "Assistant", permission: "settings.write" },
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
  const allowed: Record<string, boolean> = {
    "users.manage": canManageUsers,
    "audit.read": canReadAudit,
    "settings.write": canWriteSettings,
  };
  const tabs = TABS.filter(
    (entry) => !("permission" in entry) || allowed[entry.permission],
  );

  return (
    <>
      <PageHeader
        title="Settings"
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
      {tab === "fx" ? <FxPanel settings={initialSettings} /> : null}
      {tab === "users" && canManageUsers ? (
        <UsersPanel initialUsers={initialUsers} />
      ) : null}
      {tab === "audit" && canReadAudit ? <AuditPanel /> : null}
      {tab === "assistant" && canWriteSettings ? <AssistantPanel /> : null}
    </>
  );
}
