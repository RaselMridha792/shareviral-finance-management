"use client";

import { useState } from "react";

import { ExportPanel } from "@/components/imports/export-panel";
import { ImportScreen } from "@/components/imports/import-screen";
import { PageHeader } from "@/components/ui/page-header";
import type { ImportBatch, UploadResult } from "@/lib/imports";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";

/**
 * Import and Export — one screen, two directions.
 *
 * They are the same page because they are the same question asked twice: how
 * does a spreadsheet get in, and how does one come out. Keeping them apart
 * would have meant a second entry in the rail for a screen somebody visits
 * once a month.
 *
 * The header lives here rather than in either tab. Two tabs that each drew
 * their own title would redraw the page heading on every switch, and the
 * heading is the one thing that does not change.
 */

const TABS = [
  { id: "import", label: "Import" },
  { id: "export", label: "Export" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DataScreen({
  initialBatches,
  accounts,
  categories,
  resume = null,
  initialTab = "import",
}: {
  initialBatches: ImportBatch[];
  accounts: AccountDto[];
  categories: CategoryNode[];
  resume?:
    | (UploadResult & { columnMap: Record<string, string | null> | null })
    | null;
  initialTab?: TabId;
}) {
  /*
   * Import wins when a batch is handed over, whatever the URL asked for.
   *
   * The assistant stages a file and sends somebody here with `?batch=`. Landing
   * them on the export tab with their rows sitting one click away, invisible,
   * is the same failure the resume behaviour was written to fix.
   */
  const [tab, setTab] = useState<TabId>(resume ? "import" : initialTab);

  return (
    <>
      <PageHeader
        title="Import and Export"
        icon="upload_file"
        description="Bring a spreadsheet in, or take one out."
      />

      <div
        role="tablist"
        aria-label="Import and export"
        className="tabs-scroll flex gap-1 border-b border-border"
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

      {tab === "import" ? (
        <ImportScreen
          initialBatches={initialBatches}
          accounts={accounts}
          categories={categories}
          resume={resume}
        />
      ) : (
        <ExportPanel accounts={accounts} />
      )}
    </>
  );
}

