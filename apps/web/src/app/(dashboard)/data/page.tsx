import { DataScreen } from "@/components/imports/data-screen";
import { importsApi } from "@/lib/imports";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import and Export · SFM" };

export default async function DataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const batchId = typeof search.batch === "string" ? search.batch : null;

  const [batches, accounts, categories] = await Promise.all([
    importsApi.list(),
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  /**
   * `?batch=` is how a file staged somewhere else gets picked up here.
   *
   * The assistant stages an attachment and sends the person over; without
   * this they landed on an empty file picker with the rows sitting in the
   * database, visible to nobody. A batch that has gone missing or was already
   * imported is not an error worth a page for — the screen just opens at the
   * usual first step.
   */
  const resume = batchId
    ? await importsApi.resume(batchId).catch(() => null)
    : null;

  /* `?tab=export` so the tab can be linked to and survive a reload. */
  const initialTab = search.tab === "export" ? "export" : "import";

  return (
    <DataScreen
      initialBatches={batches}
      accounts={accounts}
      categories={categories}
      resume={resume}
      initialTab={initialTab}
    />
  );
}
