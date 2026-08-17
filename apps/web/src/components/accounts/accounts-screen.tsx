"use client";

import {
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type CreateAccountInput,
} from "@finance/shared";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
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
import {
  accountsApi,
  type AccountDto,
  type AccountWithBalance,
} from "@/lib/masters";
import { AccountForm } from "./account-form";

const ICONS: Record<AccountType, ComponentType<{ className?: string }>> = {
  bank: Landmark,
  cash: Banknote,
  mobile_wallet: Smartphone,
  card: CreditCard,
};

export function AccountsScreen({
  initialAccounts,
  usdRate,
}: {
  initialAccounts: AccountWithBalance[];
  /** Taka per dollar, or null when none has been recorded. */
  usdRate: string | null;
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
  /**
   * What the accounts hold now — not what they opened at.
   *
   * This summed `openingBalance`, which never changes, under a heading anybody
   * reads as "the balance". Two cash-ins of ৳1,00,000 into a tin showing
   * ৳40,000 left it showing ৳40,000, and the only clue was the caption on each
   * card. The figure comes from the API now, where it is computed once and
   * shared with the dashboard.
   */
  const total = inBase
    .reduce((sum, a) => sum + Number(a.balance), 0)
    .toFixed(2);

  async function refresh() {
    setAccounts(await accountsApi.list(true));
    router.refresh();
  }

  /**
   * Puts an archived account back.
   *
   * Archiving is filing, not deleting — a payment gateway switched off in
   * March is very often switched back on in September, and the balance and
   * every row against it were never going anywhere.
   */
  async function restore(account: AccountDto) {
    setError(null);
    try {
      await accountsApi.restore(account.id);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not restore that",
      );
    }
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
        description="Bank accounts and cards."
        actions={
          <>
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                Add account
              </Button>
            ) : null}
          </>
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
                Total held
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
                    {active.length === 1 ? "" : "s"} · opening balance plus every
                    entry since, voided rows excluded
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
                usdRate={usdRate}
                base={base}
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
                usdRate={usdRate}
                base={base}
                canWrite={canWrite}
                onEdit={() => setEditing(account)}
                onRestore={() => restore(account)}
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

/**
 * The same balance in the other currency, or null when it cannot be had.
 *
 * Only ever taka ↔ dollars, which is the only pair this company holds. An
 * account already in the base currency converts to dollars and one in dollars
 * converts back; anything else returns null rather than guessing at a cross
 * rate nobody recorded.
 */
function otherCurrency(
  balance: string,
  currency: string,
  base: string,
  usdRate: string | null,
): { value: string; currency: string } | null {
  const rate = Number(usdRate);
  if (!usdRate || !Number.isFinite(rate) || rate <= 0) return null;

  const amount = Number(balance);
  if (!Number.isFinite(amount)) return null;

  if (currency === base) {
    return { value: (amount / rate).toFixed(2), currency: "USD" };
  }
  if (currency === "USD") {
    return { value: (amount * rate).toFixed(2), currency: base };
  }
  return null;
}

function AccountCard({
  account,
  usdRate,
  base,
  canWrite,
  onEdit,
  onArchive,
  onRestore,
}: {
  account: AccountWithBalance;
  /** Taka per dollar, or null when none has been recorded. */
  usdRate: string | null;
  /** The company's base currency, from Settings. */
  base: string;
  canWrite: boolean;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
}) {
  const equivalent = otherCurrency(
    account.balance,
    account.currency,
    base,
    usdRate,
  );

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

      {/*
        The balance, in the currency the account is actually held in.

        Which one is large follows `account.currency`, not the account type: a
        card is usually the dollar one and a bank account the taka one, but
        that is a habit rather than a rule, and the day somebody adds a taka
        card the type would have been the wrong thing to read.

        The second line is a translation and is marked as one — `~`, greyed,
        with the rate in its tooltip. This app is careful never to let a
        converted figure look like a recorded one, and a balance is exactly
        where that would matter.
      */}
      <Amount
        value={account.balance}
        currency={account.currency}
        className="mt-5 block text-xl font-semibold tracking-tight"
      />

      {equivalent ? (
        <Amount
          value={equivalent.value}
          currency={equivalent.currency}
          approximate
          className="num block text-sm text-muted-foreground"
        />
      ) : (
        <span
          className="num block text-sm text-muted-foreground"
          title="No exchange rate has been recorded, so there is nothing to convert at. A figure here would be invented rather than approximate."
        >
          —
        </span>
      )}

      <p className="num mt-1.5 text-xs text-muted-foreground">
        Opened at{" "}
        <Amount value={account.openingBalance} currency={account.currency} /> on{" "}
        {account.openingBalanceOn}
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
          {onRestore ? (
            <Button size="sm" variant="ghost" onClick={onRestore}>
              <ArchiveRestore className="size-3.5" />
              Restore
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export type { CreateAccountInput };
