"use client";

import { ACCOUNT_TYPE_LABELS, type AccountType } from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy";
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { DeviceMobileIcon } from "@phosphor-icons/react/dist/ssr/DeviceMobile";
import { FlagBannerIcon } from "@phosphor-icons/react/dist/ssr/FlagBanner";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr/IdentificationCard";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { AccountWithBalance } from "@/lib/masters";
import { CardDetails } from "./card-details";
import { AccountForm } from "./account-form";
import { Panel } from "./panel";
import { formatDate } from "@/lib/utils";

/** The handoff's icon for each kind of account, the same four as the list. */
const ICONS: Record<AccountType, Icon> = {
  bank: BankIcon,
  cash: MoneyIcon,
  mobile_wallet: DeviceMobileIcon,
  card: CreditCardIcon,
};

/**
 * One account, as the thing it is — not as a list of what happened to it.
 *
 * This page used to be the register: every entry, in and out, with a running
 * balance. That answers "what happened here", and it is still a page — one
 * click away, below. What it never answered is "what is this account", which
 * is the question a page reached by a button called View details is being
 * asked. Everything typed into the Add form could be typed and never read
 * back.
 *
 * So: what it holds now, then everything it is. The register is a link.
 */
export function AccountDetailScreen({
  account,
}: {
  account: AccountWithBalance;
}) {
  // The rail knows the ancestors; only this page knows the record.
  useNameThisPage(account.name);

  const router = useRouter();
  const canWrite = useCan("accounts.write");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Refused clipboard permission. The number is on screen either way, and
      // a failed copy is not worth an error message over.
    }
  }

  const type = ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type;

  const identity: Row[] = [
    { label: "Name", value: account.name },
    { label: "Type", value: type },
    { label: "Bank", value: account.bankName },
    { label: "Branch", value: account.branch },
    // Copyable: these get typed into a bank's website, and a mistyped account
    // number is a payment to a stranger.
    { label: "Account number", value: account.accountNumber, copy: true },
    { label: "Routing number", value: account.routingNumber, copy: true },
    { label: "SWIFT / BIC", value: account.swiftCode, copy: true },
    { label: "Currency", value: account.currency },
  ];

  const opening: Row[] = [
    { label: "Opening balance", value: account.openingBalance, money: true },
    {
      label: "Opening balance date",
      value: formatDate(account.openingBalanceOn),
    },
  ];

  const missing = identity.filter((row) => !row.value);

  return (
    <>
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1.5 text-[13.5px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
      >
        <ArrowLeftIcon weight="bold" size={15} />
        All accounts
      </Link>

      <PageHeader
        title={account.name}
        icon={ICONS[account.type as AccountType] ?? BankIcon}
        description={[type, account.bankName, account.branch]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => router.push(`/accounts/${account.id}/register`)}
            >
              <ListNumbersIcon
                weight="duotone"
                size={19}
                className="text-(--sv-violet)"
              />
              Entries and balance
            </Button>
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setEditing(true)}
              >
                <PencilSimpleIcon weight="duotone" size={18} />
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      {/* What it holds now — the first thing anybody opens this page for.
          `Amount` draws the counterpart underneath at the month's rate, so the
          dollar figure is the same one the dashboard and the reports show
          rather than a second translation. */}
      <div
        className="sv-holds sv-rise relative flex flex-wrap items-center gap-[18px] overflow-hidden rounded-[11px] bg-(--sv-violet-tint) px-6 py-[22px]"
        style={{ animationDelay: "0.05s" }}
      >
        <span aria-hidden="true" className="sv-holds-blob" />
        <div className="relative min-w-65 flex-1">
          <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.14em] text-(--sv-violet-ink) uppercase">
            What this {type.toLowerCase()} holds now
            {!account.isActive ? (
              <span className="rounded-full bg-(--sv-warn-tint) px-2 py-0.5 tracking-normal text-(--sv-warn) normal-case">
                Archived
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 max-w-[70ch] text-[13.5px] text-(--sv-muted)">
            The opening figure plus every entry against it, voided rows
            excluded. Worked out by the server, so this and the dashboard cannot
            disagree.
          </p>
        </div>
        <div className="relative text-right">
          <Amount
            value={account.balance}
            className="text-[36px] font-extrabold tracking-[-0.02em] tabular-nums"
          />
        </div>
      </div>

      <div className="grid items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
        <Panel icon={IdentificationCardIcon} title="Account">
          <div className="px-5 pt-1.5 pb-3">
            {identity.map((row) => (
              <DetailRow
                key={row.label}
                row={row}
                copied={copied === row.label}
                onCopy={copy}
              />
            ))}
          </div>
        </Panel>

        {/* A card's own details, on the card's own page. Only for a card:
            a bank account has no number to print or CVC to hide. */}
        {account.type === "card" ? <CardDetails account={account} /> : null}

        <Panel
          icon={FlagBannerIcon}
          title="Where the records start"
          description="The figure this account held on the day it was added"
        >
          <div className="grid grid-cols-2 gap-3 px-5 pt-[18px]">
            {opening.map((row) => (
              <div
                key={row.label}
                className="sv-tile rounded-[11px] bg-(--sv-subtle) p-4"
              >
                <p className="text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
                  {row.label}
                </p>
                <p className="mt-1.5 text-[22px] font-extrabold tabular-nums">
                  {row.money && row.value ? (
                    <Amount value={row.value} showCounterpart={false} />
                  ) : (
                    (row.value ?? "N/A")
                  )}
                </p>
              </div>
            ))}
          </div>
          <p className="sv-note-violet mx-5 my-5 flex gap-2.5 rounded-[11px] bg-(--sv-violet-tint) px-3.5 py-3 text-[13px] leading-normal text-(--sv-violet-ink)">
            <InfoIcon weight="duotone" size={19} className="flex-none" />
            It never changes. Money arriving afterwards is an entry, not a new
            opening figure — otherwise the register and the bank statement stop
            lining up.
          </p>
        </Panel>
      </div>

      {account.notes ? (
        <Panel icon={NotePencilIcon} title="Notes">
          <p className="px-5 py-[18px] text-[14.5px] leading-relaxed whitespace-pre-line">
            {account.notes}
          </p>
        </Panel>
      ) : null}

      {/* Said once, at the bottom, rather than as "N/A" beside each blank row.
          A page of dashes reads as broken; a line naming what is missing reads
          as a thing to go and do. */}
      {missing.length > 0 ? (
        <p className="flex items-start gap-2 text-[12.5px] text-(--sv-muted)">
          <WarningIcon
            weight="duotone"
            size={16}
            className="mt-px flex-none text-(--sv-warn)"
          />
          <span>
            Not recorded yet:{" "}
            {missing.map((row) => row.label.toLowerCase()).join(", ")}.
            {account.swiftCode
              ? ""
              : " A SWIFT code is what a transfer from abroad needs."}
          </span>
        </p>
      ) : null}

      {editing ? (
        <AccountForm
          open
          account={account}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

type Row = {
  label: string;
  value: string | null;
  copy?: boolean;
  money?: boolean;
};

function DetailRow({
  row,
  copied,
  onCopy,
}: {
  row: Row;
  copied: boolean;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="sv-row-rule flex items-center gap-3 py-[11px] text-[14px]">
      <span className="flex-1 text-(--sv-muted)">{row.label}</span>
      {!row.value ? (
        <span className="text-(--sv-muted)">N/A</span>
      ) : (
        <span className="text-right font-extrabold tabular-nums">
          {row.value}
        </span>
      )}
      {/* Copyable: these get typed into a bank's website, and a mistyped
          account number is a payment to a stranger. */}
      {row.copy && row.value ? (
        <button
          type="button"
          onClick={() => onCopy(row.label, row.value as string)}
          title={`Copy the ${row.label.toLowerCase()}`}
          aria-label={`Copy the ${row.label.toLowerCase()}`}
          className="sv-button-quiet grid size-7 flex-none cursor-pointer place-items-center rounded-lg bg-(--sv-subtle)"
        >
          {copied ? (
            <CheckIcon weight="bold" size={14} className="text-(--sv-pos)" />
          ) : (
            <CopyIcon
              weight="duotone"
              size={14}
              className="text-(--sv-violet)"
            />
          )}
        </button>
      ) : null}
    </div>
  );
}
