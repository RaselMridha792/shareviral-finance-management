"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { useState } from "react";

import { ExportPanel } from "@/components/imports/export-panel";
import { ImportScreen } from "@/components/imports/import-screen";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import type { ImportBatch, UploadResult } from "@/lib/imports";
import type { AccountDto, CategoryNode } from "@/lib/masters";

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
  { id: "import", label: "Import", icon: UploadSimpleIcon },
  { id: "export", label: "Export", icon: DownloadSimpleIcon },
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

      {/* The handoff's pill group, with its icons. */}
      <Segmented
        options={TABS}
        value={tab}
        onChange={setTab}
        label="Import and export"
        className="self-start"
      />

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

