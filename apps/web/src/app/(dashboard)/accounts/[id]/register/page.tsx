import { RegisterScreen } from "@/components/accounts/register-screen";
import { ledgerApi } from "@/lib/ledger";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  params,
  searchParams,
}: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const search = await searchParams;

  const from = typeof search.from === "string" ? search.from : undefined;
  const to = typeof search.to === "string" ? search.to : undefined;

  const [register, accounts, categories] = await Promise.all([
    // Voided rows included, struck through and out of every total. This is the
    // page an auditor reads, and a correction that leaves no trace on it is
    // exactly what an audit is looking for. They do not touch the running
    // balance — the window sum skips them.
    ledgerApi.register(id, { from, to, includeVoided: true }),
    accountsApi.list(),
    categoriesApi.tree(),
  ]);

  return (
    <RegisterScreen
      register={register}
      range={{ from, to }}
      accounts={accounts}
      categories={categories}
    />
  );
}
