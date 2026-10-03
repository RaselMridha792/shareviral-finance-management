import { hasPermission } from "@finance/shared";
import { redirect } from "next/navigation";

import { HrRequestsScreen } from "@/components/hr-requests/hr-requests-screen";
import { getSession } from "@/lib/api-client";
import type { RequestKind, StateFilter } from "@/lib/hr-requests";
import { accountsApi, categoriesApi } from "@/lib/masters";

export const dynamic = "force-dynamic";

export const metadata = { title: "HR Requests \u00b7 SFM" };

const KINDS: RequestKind[] = ["pay_change", "one_off", "budget", "spend"];
const STATES: StateFilter[] = [
  "waiting",
  "pending",
  "held",
  "to_pay",
  "approved",
  "rejected",
  "withdrawn",
  "all",
];

/**
 * Every money request from the HR portal (#125). Gated here on
 * `hrrequests.read` \u2014 the CFO, the Super Admin, and the CEO to read.
 *
 * `?kind=` and `?open=<id>` open one row: the salary sheet's warning and the
 * bell link straight to the request they name. `?state=` and `?month=` set
 * the filters. The accounts and headings are for paying an approved spend.
 */
export default async function HrRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasPermission(user.role, "hrrequests.read")) {
    redirect("/no-access?from=/hr-requests&needs=hrrequests.read");
  }
  const search = await searchParams;
  const one = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const kind = KINDS.find((k) => k === one("kind"));
  const state = STATES.find((s) => s === one("state"));
  const month = /^\d{4}-\d{2}$/.test(one("month") ?? "")
    ? one("month")
    : undefined;
  const open = /^[0-9a-f-]{36}$/i.test(one("open") ?? "")
    ? one("open")
    : undefined;

  const canPay =
    hasPermission(user.role, "hrbudget.manage") &&
    hasPermission(user.role, "transactions.write");
  const [accounts, categories] = canPay
    ? await Promise.all([
        accountsApi.list().catch(() => []),
        categoriesApi.tree().catch(() => []),
      ])
    : [[], []];

  return (
    <HrRequestsScreen
      key={`${kind ?? ""}-${open ?? ""}`}
      initial={{ kind, state, month, open }}
      accounts={accounts.filter(
        (account) => account.type === "bank" || account.type === "cash",
      )}
      categories={categories}
    />
  );
}
