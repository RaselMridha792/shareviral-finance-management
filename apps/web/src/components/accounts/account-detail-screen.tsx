"use client";

import { ACCOUNT_TYPE_LABELS, type AccountType } from "@finance/shared";
import {
  ArrowLeft,
  Check,
  Copy,
  ListOrdered,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { AccountWithBalance } from "@/lib/masters";
import { AccountForm } from "./account-form";

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
    { label: "As at", value: account.openingBalanceOn },
  ];

  const missing = identity.filter((row) => !row.value);

  return (
    <>
      <Link
        href="/accounts"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All accounts
      </Link>

      <PageHeader
        title={account.name}
        icon="account_balance"
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
              <ListOrdered className="size-4" />
              Entries and balance
            </Button>
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      {/* What it holds now, in both currencies — the first thing anybody opens
          this page for. `Amount` renders the counterpart underneath at the
          month's rate, so the dollar figure here is the same one the dashboard
          and the reports show rather than a second translation. */}
      <Card className="px-5 py-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What this {type.toLowerCase()} holds now
        </p>
        <Amount
          value={account.balance}
          className="mt-2 block text-3xl font-semibold"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          The opening figure plus every entry against it, voided rows excluded.
          Worked out by the server, so this and the dashboard cannot disagree.
        </p>
        {!account.isActive ? (
          <Badge tone="warning" className="mt-3">
            Archived
          </Badge>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            {identity.map((row) => (
              <DetailRow
                key={row.label}
                row={row}
                copied={copied === row.label}
                onCopy={copy}
              />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Where the records start"
            description="The figure this account held on the day it was added"
          />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            {opening.map((row) => (
              <DetailRow
                key={row.label}
                row={row}
                copied={false}
                onCopy={copy}
              />
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              It never changes. Money arriving afterwards is an entry, not a new
              opening figure — otherwise the register and the bank statement
              stop lining up.
            </p>
          </CardBody>
        </Card>

        {account.notes ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Notes" />
            <CardBody className="text-sm">
              <p className="whitespace-pre-line">{account.notes}</p>
            </CardBody>
          </Card>
        ) : null}
      </div>

      {/* Said once, at the bottom, rather than as "—" beside each blank row.
          A page of dashes reads as broken; a line naming what is missing reads
          as a thing to go and do. */}
      {missing.length > 0 ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
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
  currency,
  copied,
  onCopy,
}: {
  row: Row;
  currency?: string;
  copied: boolean;
  onCopy: (label: string, value: string) => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{row.label}</span>
      {!row.value ? (
        <span className="text-muted-foreground">—</span>
      ) : row.money ? (
        <Amount
          value={row.value}
          currency={currency}
          showCounterpart={false}
          className="font-medium"
        />
      ) : row.copy ? (
        <button
          type="button"
          onClick={() => onCopy(row.label, row.value as string)}
          title={`Copy the ${row.label.toLowerCase()}`}
          className="num inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-right transition hover:bg-surface-muted"
        >
          {row.value}
          {copied ? (
            <Check className="size-3 shrink-0 text-positive" />
          ) : (
            <Copy className="size-3 shrink-0 text-muted-foreground" />
          )}
        </button>
      ) : (
        <span className="text-right font-medium">{row.value}</span>
      )}
    </div>
  );
}
