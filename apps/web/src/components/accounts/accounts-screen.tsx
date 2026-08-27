"use client";

import {
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type CreateAccountInput,
} from "@finance/shared";
import {
  Archive,
  ArchiveRestore,
  Plus,
  SquarePen,
  SquareArrowOutUpRight,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useSettings } from "@/components/settings-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { SummaryBar } from "@/components/ui/patterns";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ApiError } from "@/lib/api-client";
import {
  accountsApi,
  type AccountDto,
  type AccountWithBalance,
} from "@/lib/masters";
import { AccountForm } from "./account-form";

/** The handoff's own four, by name. */
const ICONS: Record<AccountType, string> = {
  bank: "account_balance",
  cash: "payments",
  mobile_wallet: "smartphone",
  card: "credit_card",
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
  /** Only ever an archived one — the card offers no Delete otherwise. */
  const [deleting, setDeleting] = useState<AccountWithBalance | null>(null);

  /*
   * Every active account, and no currency filter.
   *
   * There used to be one: accounts whose `currency` was not the base were left
   * out of the total, on the reasoning that adding dollars to taka gives a
   * figure that is money in neither. True, but not the situation — the field
   * marks which account is the foreign-spend one; every balance behind it is
   * already in taka. The filter was quietly under-reporting the total by
   * whatever the card held.
   */
  const base = settings.baseCurrency;
  /**
   * What the accounts hold now — not what they opened at.
   *
   * This summed `openingBalance`, which never changes, under a heading anybody
   * reads as "the balance". Two cash-ins of ৳1,00,000 into a tin showing
   * ৳40,000 left it showing ৳40,000, and the only clue was the caption on each
   * card. The figure comes from the API now, where it is computed once and
   * shared with the dashboard.
   */
  const total = active
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
        icon="account_balance"
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
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Icon
              name="account_balance"
              size={22}
              className="text-primary-text"
            />
          </span>
          <div>
            <p className="text-lg font-semibold">No accounts yet</p>
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
          <SummaryBar
            label="Total held"
            icon="savings"
            iconTone="text-primary-text"
            description={
              <>
                {active.length} active account{active.length === 1 ? "" : "s"} ·
                opening balance plus every entry since, voided rows excluded
              </>
            }
            // `Amount` draws its own dollar line underneath, so the bar's
            // secondary slot would be a second one saying the same thing.
            value={<Amount value={total} currency={base} />}
          />

          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
            }}
          >
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
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))",
            }}
          >
            {archived.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                usdRate={usdRate}
                base={base}
                canWrite={canWrite}
                onEdit={() => setEditing(account)}
                onRestore={() => restore(account)}
                onDelete={() => setDeleting(account)}
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
      {deleting ? (
        <DeleteAccountDialog
          accountId={deleting.id}
          accountName={deleting.name}
          currency={deleting.currency}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            refresh();
          }}
        />
      ) : null}

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

/**
 * A balance that cannot be true, as opposed to one that is merely bad.
 *
 * A tin of cash cannot hold less than nothing, and a bKash wallet cannot go
 * below zero — the provider refuses the payment. So a negative figure on either
 * is never a fact about the money; it is the records telling you something is
 * missing from them. Petty cash showed −৳6,97,475 for weeks, in the same
 * unremarkable styling as every other balance.
 *
 * A bank account is deliberately excluded. An overdraft is a real thing a real
 * bank grants, and warning about a true figure teaches people to ignore the
 * warning.
 *
 * The sign is read off the string rather than through `Number()`, because money
 * is `numeric(14,2)` and this codebase does not do arithmetic on it in JS. A
 * leading minus is all the question needs.
 */
function impossiblyNegative(account: AccountWithBalance): boolean {
  const holdsPhysicalMoney =
    account.type === "cash" || account.type === "mobile_wallet";
  return holdsPhysicalMoney && account.balance.trim().startsWith("-");
}

/**
 * Names the likeliest cause and stops.
 *
 * "Negative balance" would tell somebody what they can already see. What they
 * cannot see is *why* — and in practice it is nearly always the same why: money
 * was spent out of the tin and the top-up that put it there was never entered.
 * Warning rather than negative, because nothing has been lost: the money is
 * fine and the record of it is not.
 */
function ImpossibleBalanceNote() {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>
        <span className="font-medium">This balance cannot be right.</span> Cash
        and wallets cannot hold less than nothing, so something is missing from
        the records — most often money put into this account that was never
        entered. Recording the cash that came in should bring it back.
      </span>
    </p>
  );
}

function AccountCard({
  account,
  usdRate,
  base,
  canWrite,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
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
  /** Archived cards only. An account in use is archived first. */
  onDelete?: () => void;
}) {
  // Taka in, dollars out — the figure is BDT whatever the account is called.
  const equivalent = otherCurrency(account.balance, base, base, usdRate);

  const symbol = ICONS[account.type];

  return (
    <Card className={account.isActive ? "p-5" : "p-5 opacity-60"}>
      <div className="flex items-start gap-3">
        <span className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <Icon name={symbol} size={21} className="text-primary-text" />
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
        The balance, in taka — including on the card that is *called* a dollar
        one.

        `account.currency` says which account is the foreign-spend one. It does
        not say what this figure is denominated in: every amount this system
        stores is BDT, the card's included, with the foreign figure kept beside
        the transaction that recorded it. Reading the account's label as the
        figure's currency printed "$29,562.00" over "~৳35,10,487.50" — one
        balance, stated twice, a hundred and eighteen times apart.

        The second line is a translation and is marked as one — `~`, greyed,
        with the rate in its tooltip. This app is careful never to let a
        converted figure look like a recorded one, and a balance is exactly
        where that would matter.
      */}
      {/* Right-aligned, so a column of cards lines its figures up against one
          edge instead of leaving the eye to find each one. */}
      {/*
        Which figure sits on top follows the account's PRIMARY currency, on
        the owner's instruction: a USD-primary card leads with the dollars and
        keeps the taka underneath, a BDT account the reverse. What must not
        move is the honesty rule above — the dollars are still a translation
        however large they are printed, so the `~` and the grey second line
        swap places with the figure rather than being dropped. And with no
        recorded rate there IS no dollar figure, so a USD-primary card falls
        back to taka-first rather than promoting a blank.
      */}
      {account.currency === "USD" && equivalent ? (
        <>
          <Amount
            value={equivalent.value}
            currency={equivalent.currency}
            approximate
            showCounterpart={false}
            className="mt-5 block text-right text-[clamp(22px,1.8vw,28px)] font-semibold tracking-tight"
          />
          <Amount
            value={account.balance}
            currency={base}
            showCounterpart={false}
            className="num block text-right text-sm text-faint"
          />
        </>
      ) : (
        <>
          <Amount
            value={account.balance}
            currency={base}
            showCounterpart={false}
            className="mt-5 block text-right text-[clamp(22px,1.8vw,28px)] font-semibold tracking-tight"
          />
          {equivalent ? (
            <Amount
              value={equivalent.value}
              currency={equivalent.currency}
              approximate
              showCounterpart={false}
              className="num block text-right text-sm text-faint"
            />
          ) : (
            <span
              className="num block text-right text-sm text-faint"
              title="No exchange rate has been recorded, so there is nothing to convert at. A figure here would be invented rather than approximate."
            >
              N/A
            </span>
          )}
        </>
      )}

      <p className="num mt-3 border-t border-border-soft pt-3 text-xs text-muted-foreground">
        Opened at{" "}
        <Amount
          value={account.openingBalance}
          currency={base}
          showCounterpart={false}
        />{" "}
        on {account.openingBalanceOn}
      </p>

      {impossiblyNegative(account) ? <ImpossibleBalanceNote /> : null}

      {/*
        Outside the canWrite check, and that is the point of adding it.
        Until now this card had no link to the account at all — the register
        and everything the account holds were reachable only by typing a URL —
        and reading is not writing. The CEO can read and never edit.
      */}
      <div className="mt-4 flex gap-2 border-t border-border pt-3">
        <Link
          href={`/accounts/${account.id}`}
          className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-primary transition hover:bg-primary/10"
        >
          <SquareArrowOutUpRight className="size-3.5" />
          View details
        </Link>
      </div>

      {canWrite ? (
        <div className="mt-1 flex gap-2">
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
          {onDelete ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-negative hover:bg-negative/10 hover:text-negative"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export type { CreateAccountInput };
