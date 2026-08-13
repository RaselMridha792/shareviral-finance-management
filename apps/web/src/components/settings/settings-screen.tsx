"use client";

import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import type { AppSettingsDto } from "@/components/settings-provider";
import type { CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";
import { CategoriesPanel } from "./categories-panel";
import { CompanyPanel } from "./company-panel";
import { FxPanel } from "./fx-panel";

const TABS = [
  { id: "company", label: "Company & formatting" },
  { id: "categories", label: "Categories" },
  { id: "fx", label: "Exchange rate" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsScreen({
  initialSettings,
  initialTree,
}: {
  initialSettings: AppSettingsDto;
  initialTree: CategoryNode[];
}) {
  const [tab, setTab] = useState<TabId>("company");

  return (
    <>
      <PageHeader
        title="Settings"
        description="Company details, how figures are shown, categories, and the USD rate."
      />

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((entry) => (
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
    </>
  );
}
