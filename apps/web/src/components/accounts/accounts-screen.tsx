"use client";

import {
  ACCOUNT_TYPE_LABELS,
  fromMinorUnits,
  isBeforeRecords,
  monthRange,
  toMinorUnits,
  todayInDhaka,
  type AccountType,
  type CreateAccountInput,
} from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { PiggyBankIcon } from "@phosphor-icons/react/dist/ssr/PiggyBank";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useSettings } from "@/components/settings-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/field";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { ApiError } from "@/lib/api-client";
import {
  accountsApi,
  type AccountDto,
  type AccountWithBalance,
} from "@/lib/masters";
import { AccountForm } from "./account-form";
import { formatDate } from "@/lib/utils";

/**
 * Every month the books cover, newest first, as an "as at the end of" cutoff.
 *
 * Its own list rather than the Expenses screens' `MonthFilter`, and the reason
 * is one word on one row. That control's escape hatch reads **Every month**,
 * which is the right answer for a screen listing entries and a meaningless one
 * for a screen showing balances — a balance is a figure at a moment, so the
 * escape here is **As it stands now**. Reusing the control would have meant
 * changing that label for the three Expenses screens and the subscriptions
 * register too, to say something none of them mean.
 *
 * The list itself is built the same way and for the same reason: assembled from
 * the months that have actually happened, so it carries no greyed rows and
 * grows on its own.
 */
function monthEnds(): { value: string; label: string }[] {
  const today = todayInDhaka();
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));

  const months: { value: string; label: string }[] = [];
  while (!isBeforeRecords(year, month)) {
    const range = monthRange(year, month);
    months.push({ value: range.end, label: range.label });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return months;
}

/** The handoff's own four. */
const ICONS: Record<AccountType, Icon> = {
  bank: BankIcon,
  cash: MoneyIcon,
  mobile_wallet: DeviceMobileIcon,
  card: CreditCardIcon,
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
  /*
   * Which day the balances are read at. Null is today, which is what the page
   * opens on and what it has always shown.
   *
   * The owner: *"account overview page a date month filter any diyo dropdown
   * akare"*. On a screen of balances a month means one thing — what each
   * account held when that month ended — so the dropdown sends the month's last
   * day and the server counts only entries up to it.
   */
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loadingAsOf, setLoadingAsOf] = useState(false);
  const months = useMemo(() => monthEnds(), []);
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
   *
   * Added in paisa, as whole numbers. It was `Number(a) + Number(b)`, which is
   * floating point — the one way this app promises money is never added.
   */
  const total = fromMinorUnits(
    active.reduce((sum, a) => sum + toMinorUnits(a.balance), BigInt(0)),
  );

  async function refresh() {
    setAccounts(await accountsApi.list(true, asOf ?? undefined));
    router.refresh();
  }

  /** Re-reads every balance at the chosen cutoff. */
  async function showAsOf(next: string | null) {
    setAsOf(next);
    setLoadingAsOf(true);
    setError(null);
    try {
      setAccounts(await accountsApi.list(true, next ?? undefined));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not read the balances for that month",
      );
    } finally {
      setLoadingAsOf(false);
    }
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
            {/*
              A balance is a figure at a moment, so this names the moment. It
              sits beside Add account rather than above the cards because it
              governs every figure on the page, the total included — a filter
              under what it changes is a filter people meet after the numbers
              it decided.
            */}
            <Select
              aria-label="Balances as at"
              className="w-auto shrink-0 font-medium"
              value={asOf ?? ""}
              disabled={loadingAsOf}
              onChange={(event) => void showAsOf(event.target.value || null)}
            >
              <option value="">As it stands now</option>
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  End of {month.label}
                </option>
              ))}
            </Select>
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <PlusCircleIcon weight="duotone" size={19} />
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
        <div className="sv-card flex flex-col items-center gap-3 rounded-[14px] bg-(--sv-surface) px-6 py-14 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-(--sv-lime-tint) text-(--sv-violet-ink)">
            <BankIcon weight="duotone" size={30} />
          </span>
          <p className="text-[19px] font-extrabold">No accounts yet</p>
          <p className="max-w-[46ch] text-[14.5px] text-(--sv-muted)">
            Add your bank accounts and petty cash, each with the balance it held
            on the day your records start here.
          </p>
          {canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <PlusCircleIcon weight="duotone" size={19} />
              Add the first account
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/*
            What every active account holds, added up — the handoff's lime band
            with the piggy-bank tile. The dollars stay small underneath, the
            same rule as every other taka figure here.
          */}
          <div
            className="sv-total sv-rise relative flex flex-wrap items-center gap-[18px] overflow-hidden rounded-[11px] bg-(--sv-lime-tint) px-6 py-[22px]"
            style={{ animationDelay: "0.05s" }}
          >
            <span aria-hidden="true" className="sv-total-blob" />
            <span className="sv-total-tile relative grid size-[46px] flex-none place-items-center rounded-[11px] bg-(--sv-surface) text-(--sv-violet)">
              <PiggyBankIcon weight="duotone" size={25} />
            </span>
            <div className="relative min-w-60 flex-1">
              <p className="text-[11px] font-extrabold tracking-[0.14em] text-(--sv-violet-ink) uppercase">
                {asOf
                  ? `Held at the end of ${months.find((month) => month.value === asOf)?.label ?? "the month"}`
                  : "Total held"}
              </p>
              <p className="mt-[3px] text-[13.5px] text-(--sv-muted)">
                {active.length} active account{active.length === 1 ? "" : "s"} ·
                opening balance plus every entry since, voided rows excluded
              </p>
            </div>
            <div className="relative text-right">
              <Amount
                value={total}
                currency={base}
                className="text-[34px] font-extrabold tracking-[-0.02em] tabular-nums"
              />
            </div>
          </div>

          <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
            {active.map((account, index) => (
              <AccountCard
                key={account.id}
                account={account}
                usdRate={usdRate}
                base={base}
                canWrite={canWrite}
                tone={TONES[index % TONES.length]}
                delay={0.1 + index * 0.05}
                onEdit={() => setEditing(account)}
                onArchive={() => archive(account)}
              />
            ))}
          </div>
        </>
      )}

      {archived.length > 0 ? (
        <section className="sv-archived flex flex-col gap-3 rounded-[11px] bg-(--sv-subtle) p-4">
          <h2 className="text-[11px] font-extrabold tracking-[0.14em] text-(--sv-muted) uppercase">
            Archived
          </h2>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))]">
            {archived.map((account, index) => (
              <AccountCard
                key={account.id}
                account={account}
                usdRate={usdRate}
                base={base}
                canWrite={canWrite}
                tone={TONES[index % TONES.length]}
                delay={0}
                onEdit={() => setEditing(account)}
                onRestore={() => restore(account)}
                onDelete={() => setDeleting(account)}
              />
            ))}
          </div>
        </section>
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
    <p className="sv-warn-note flex items-start gap-2 rounded-[11px] bg-(--sv-warn-tint) px-3 py-2.5 text-[12.5px] leading-normal text-(--sv-ink)">
      <WarningIcon
        weight="duotone"
        size={17}
        className="mt-px flex-none text-(--sv-warn)"
      />
      <span>
        <span className="font-medium">This balance cannot be right.</span> Cash
        and wallets cannot hold less than nothing, so something is missing from
        the records — most often money put into this account that was never
        entered. Recording the cash that came in should bring it back.
      </span>
    </p>
  );
}

/**
 * The four looks a card takes, in turn across the grid — the owner's September
 * drawing of this page, with its two pale cards deepened at the owner's word
 * (ink and ocean in place of paper and lilac). Nothing about the account picks
 * its colour; the drawing cycles them so a row of four never repeats, and so
 * does this.
 */
const TONES = ["ink", "violet", "lime", "ocean"] as const;
type Tone = (typeof TONES)[number];

/**
 * What goes on the card's number line.
 *
 * The account number as it was entered, which is how the bank prints it on a
 * statement. A card with no account number shows its last four behind dots —
 * the only part of a card number this app keeps where it can be read.
 */
function numberLine(account: AccountWithBalance): string | null {
  if (account.accountNumber) return account.accountNumber;
  if (account.cardLast4) return `•••• •••• •••• ${account.cardLast4}`;
  return null;
}

function AccountCard({
  account,
  usdRate,
  base,
  canWrite,
  tone,
  delay,
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
  tone: Tone;
  /** Seconds before this card rises in, so a grid of them staggers. */
  delay: number;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  /** Archived cards only. An account in use is archived first. */
  onDelete?: () => void;
}) {
  // Taka in, dollars out — the figure is BDT whatever the account is called.
  const equivalent = otherCurrency(account.balance, base, base, usdRate);

  const Glyph = ICONS[account.type];
  const number = numberLine(account);

  return (
    <div
      className={
        account.isActive
          ? "sv-card sv-card-lift sv-rise flex flex-col rounded-[18px] bg-(--sv-surface) px-3 pt-3 pb-4"
          : "sv-card flex flex-col rounded-[18px] bg-(--sv-surface) px-3 pt-3 pb-4 opacity-70"
      }
      style={delay ? { animationDelay: `${delay}s` } : undefined}
      // Hooks for the harnesses, which read a card by what it is rather than
      // by the classes that happen to draw it.
      data-account-id={account.id}
    >
      {/*
        The account drawn as the card it is: the issuer and a currency tag
        across the top, a chip, the number, and the account's name opposite
        the balance along the bottom.

        The balance on it follows the account's PRIMARY currency, on the
        owner's instruction: a USD-primary account leads with its own dollars
        (`ownBalance`, what each row carried — only an inexact one wears the
        `~`), a BDT one with taka. The other currency is the smaller figure
        under the card. Every stored amount is BDT whatever `currency` says; the
        field marks which account is the foreign-spend one.
      */}
      <div
        data-tone={tone}
        className="sv-bankcard relative flex aspect-[1.6] flex-col overflow-hidden rounded-[16px] p-[18px]"
      >
        <span aria-hidden="true" className="sv-bankcard-glow" />
        <span aria-hidden="true" className="sv-bankcard-ring" />

        <div className="relative flex items-center gap-2">
          <Glyph weight="duotone" size={19} className="flex-none" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-extrabold">
            {account.bankName || ACCOUNT_TYPE_LABELS[account.type]}
          </p>
          {/* A card says so; anything else says what it holds. */}
          <span className="sv-bankcard-pill flex-none rounded-full px-2.5 py-[3px] text-[11px] font-extrabold tracking-[0.1em]">
            {account.type === "card" ? "CARD" : account.currency}
          </span>
        </div>

        <span
          aria-hidden="true"
          className="sv-bankcard-chip relative mt-3.5 block h-7 w-[38px] rounded-[6px]"
        />

        <div className="relative mt-auto">
          {/* A blank line rather than none, so every card's name and balance
              sit at the same height. */}
          <p className="sv-bankcard-number min-h-[1lh] truncate font-mono text-[13px] tracking-[0.12em]">
            {number}
          </p>
          <div className="mt-2.5 flex items-end justify-between gap-3">
            <p
              data-account-name=""
              className="min-w-0 truncate pb-0.5 text-[13.5px] font-extrabold"
            >
              {account.name}
            </p>
            {account.currency === "USD" ? (
              <Amount
                value={account.ownBalance}
                currency="USD"
                approximate={!account.ownBalanceExact}
                showCounterpart={false}
                className="flex-none text-[22px] leading-none font-extrabold tracking-[-0.02em] tabular-nums"
              />
            ) : (
              <Amount
                value={account.balance}
                currency={base}
                showCounterpart={false}
                className="flex-none text-[22px] leading-none font-extrabold tracking-[-0.02em] tabular-nums"
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 px-2 text-[12.5px]">
        <span className="flex min-w-0 items-center gap-2 text-(--sv-muted)">
          <CalendarBlankIcon
            weight="duotone"
            size={16}
            className="flex-none text-(--sv-violet)"
          />
          <span className="truncate">
            Opened {formatDate(account.openingBalanceOn)}
          </span>
        </span>
        {account.currency === "USD" ? (
          <Amount
            value={account.balance}
            currency={base}
            showCounterpart={false}
            className="flex-none font-extrabold tabular-nums"
          />
        ) : equivalent ? (
          <Amount
            value={equivalent.value}
            currency={equivalent.currency}
            approximate
            showCounterpart={false}
            className="flex-none font-extrabold tabular-nums"
          />
        ) : (
          <span
            className="flex-none text-(--sv-muted)"
            title="No exchange rate has been recorded, so there is nothing to convert at. A figure here would be invented rather than approximate."
          >
            N/A
          </span>
        )}
      </div>

      {impossiblyNegative(account) ? (
        <div className="mx-1 mt-3">
          <ImpossibleBalanceNote />
        </div>
      ) : null}

      {/*
        View details is outside the canWrite check, and that is the point of
        it: reading is not writing, and the CEO can read and never edit.
      */}
      <div className="sv-bankcard-actions mt-[15px] flex items-center gap-2 px-1">
        <Link
          href={`/accounts/${account.id}`}
          className="inline-flex h-[38px] flex-1 items-center justify-center gap-[7px] rounded-lg bg-primary px-[13px] text-[14px] font-extrabold text-primary-foreground shadow-[0_6px_16px_rgb(150_200_0/0.28)] transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-(--sv-accent-hover)"
        >
          View details
          <ArrowRightIcon weight="bold" size={15} />
        </Link>

        {canWrite ? (
          <>
            <button
              type="button"
              className="sv-row-button"
              aria-label={`Edit ${account.name}`}
              title="Edit"
              onClick={onEdit}
            >
              <PencilSimpleIcon weight="duotone" size={18} />
            </button>
            {onArchive ? (
              <button
                type="button"
                className="sv-row-button"
                aria-label={`Archive ${account.name}`}
                title="Archive"
                onClick={onArchive}
              >
                <ArchiveIcon weight="duotone" size={18} />
              </button>
            ) : null}
            {onRestore ? (
              <button
                type="button"
                className="sv-row-button"
                aria-label={`Restore ${account.name}`}
                title="Restore"
                onClick={onRestore}
              >
                <ArrowCounterClockwiseIcon weight="duotone" size={18} />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="sv-row-button"
                data-tone="danger"
                aria-label={`Delete ${account.name}`}
                title="Delete"
                onClick={onDelete}
              >
                <TrashIcon weight="duotone" size={18} />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export type { CreateAccountInput };
