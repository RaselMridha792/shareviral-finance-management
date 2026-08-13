import { ImportScreen } from "@/components/imports/import-screen";
import { importsApi } from "@/lib/imports";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "Import · SFM" };

export default async function ImportPage() {
  const [batches, accounts, categories] = await Promise.all([
    importsApi.list(),
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return (
    <ImportScreen
      initialBatches={batches}
      accounts={accounts}
      categories={categories}
    />
  );
}
