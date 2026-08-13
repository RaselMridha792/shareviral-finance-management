import { hasPermission, monthRange, todayInDhaka } from "@finance/shared";
import type { PendingItem } from "@finance/shared";

import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { getSession } from "@/lib/api-client";
import { ledgerApi } from "@/lib/ledger";
import { accountsApi } from "@/lib/masters";
import { incomeTaxApi, tdsApi } from "@/lib/tax";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSession();

  const today = todayInDhaka();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const thisMonth = monthRange(year, month);
  const lastMonth = monthRange(
    month === 1 ? year - 1 : year,
    month === 1 ? 12 : month - 1,
  );

  // HR signs in here too, and holds none of the money permissions. Asking for
  // figures they may not see would 403 and take the whole page down, so the
  // dashboard asks only for what this role is allowed to know.
  const seesMoney = hasPermission(user?.role, "dashboard.money");
  const seesTds = hasPermission(user?.role, "tds.read");
  const seesIncomeTax = hasPermission(user?.role, "incometax.read");

  const [accounts, current, previous, expenses] = seesMoney
    ? await Promise.all([
        accountsApi.list(),
        ledgerApi.summary({ from: thisMonth.start, to: thisMonth.end }),
        ledgerApi.summary({ from: lastMonth.start, to: lastMonth.end }),
        ledgerApi.expenseSummary({ from: thisMonth.start, to: thisMonth.end }),
      ])
    : [[], null, null, null];

  // Phase 7 replaces this with a balances endpoint that folds in the ledger;
  // until then the opening balance plus this month's net is the honest figure
  // we can show without a second round of queries per account.
  const balances = await Promise.all(
    accounts.map(async (account) => {
      const register = await ledgerApi.register(account.id);
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        balance: register.closingBalance,
      };
    }),
  );

  const pending: PendingItem[] = (
    await Promise.all([
      seesTds ? tdsApi.pending() : Promise.resolve([]),
      seesIncomeTax ? incomeTaxApi.pending() : Promise.resolve([]),
    ])
  )
    .flat()
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));

  return (
    <DashboardScreen
      firstName={user?.fullName.split(" ")[0] ?? "there"}
      monthLabel={thisMonth.label}
      balances={balances}
      current={current}
      previous={previous}
      expenses={expenses}
      pending={pending}
    />
  );
}
