"use client";

import {
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type CreateAccountInput,
} from "@finance/shared";
import {
  Archive,
  Banknote,
  Landmark,
  Plus,
  Smartphone,
  SquarePen,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useSettings } from "@/components/settings-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { accountsApi, type AccountDto } from "@/lib/masters";
import { AccountForm } from "./account-form";

const ICONS: Record<AccountType, ComponentType<{ className?: string }>> = {
  bank: Landmark,
  cash: Banknote,
  mobile_wallet: Smartphone,
};

export function AccountsScreen({
  initialAccounts,
}: {
  initialAccounts: AccountDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("accounts.write");

  const [accounts, setAccounts] = useState(initialAccounts);
  const [editing, setEditing] = useState<AccountDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = useSettings();
  const active = accounts.filter((a) => a.isActive);
  const archived = accounts.filter((a) => !a.isActive);

  // Only the base currency. Adding a USD balance to a BDT one gives a figure
  // that is not money in either — and it would look completely ordinary.
  const base = settings.baseCurrency;
  const inBase = active.filter((a) => a.currency === base);
  const otherCurrencies = active.filter((a) => a.currency !== base).length;
  const total = inBase
    .reduce((sum, a) => sum + Number(a.openingBalance), 0)
    .toFixed(2);

  async function refresh() {
    setAccounts(await accountsApi.list(true));
    router.refresh();
  }

  async function archive(account: AccountDto) {
    setError(null);
    try {
      await accountsApi.archive(account.id);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not archive that",
      );
    }
  }

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Where money sits — bank accounts, cash, and mobile wallets."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              Add account
            </Button>
          ) : null
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {active.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Landmark className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">No accounts yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add your bank accounts and petty cash, each with the balance it
              held on the day your records start here.
            </p>
          </div>
          {canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              Add the first account
            </Button>
          ) : null}
        </Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Opening total
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {otherCurrencies > 0 ? (
                  <>
                    {inBase.length} account{inBase.length === 1 ? "" : "s"} in{" "}
                    {base}. {otherCurrencies} in another currency, counted
                    separately — mixing them would give a figure that is money
                    in neither.
                  </>
                ) : (
                  <>
                    {active.length} active account
                    {active.length === 1 ? "" : "s"} · balances start moving once
                    the ledger arrives
                  </>
                )}
              </p>
            </div>
            <Amount value={total} currency={base} className="text-2xl font-semibold" />
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                canWrite={canWrite}
                onEdit={() => setEditing(account)}
                onArchive={() => archive(account)}
              />
            ))}
          </div>
        </>
      )}

      {archived.length > 0 ? (
        <div>
          <h2 className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Archived
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                canWrite={canWrite}
                onEdit={() => setEditing(account)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <AccountForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={refresh}
      />
      <AccountForm
        key={editing?.id}
        open={Boolean(editing)}
        account={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
    </>
  );
}

function AccountCard({
  account,
  canWrite,
  onEdit,
  onArchive,
}: {
  account: AccountDto;
  canWrite: boolean;
  onEdit: () => void;
  onArchive?: () => void;
}) {
  const Icon = ICONS[account.type];

  return (
    <Card className={account.isActive ? "p-5" : "p-5 opacity-60"}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[account.bankName, account.accountNumber]
              .filter(Boolean)
              .join(" · ") || ACCOUNT_TYPE_LABELS[account.type]}
          </p>
        </div>
        <Badge>{ACCOUNT_TYPE_LABELS[account.type]}</Badge>
      </div>

      <Amount
        value={account.openingBalance}
        currency={account.currency}
        className="mt-5 block text-xl font-semibold tracking-tight"
      />
      <p className="num mt-0.5 text-xs text-muted-foreground">
        Opening balance on {account.openingBalanceOn}
      </p>

      {canWrite ? (
        <div className="mt-4 flex gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <SquarePen className="size-3.5" />
            Edit
          </Button>
          {onArchive ? (
            <Button size="sm" variant="ghost" onClick={onArchive}>
              <Archive className="size-3.5" />
              Archive
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export type { CreateAccountInput };
