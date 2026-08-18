"use client";

import { ACCOUNT_TYPE_LABELS, type AccountType } from "@finance/shared";
import { ChevronDown, Copy, Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { AccountDto } from "@/lib/masters";
import { cn } from "@/lib/utils";

/**
 * Everything the account itself holds.
 *
 * Until now this could all be typed in and none of it read back: branch,
 * account number, routing number, SWIFT, the opening figure and its date, the
 * notes. The account page showed the register — every entry against the
 * account — and nothing about the account.
 *
 * Sits above the register rather than on a route of its own, so `/accounts/:id`
 * is simply "the account" and there is one address to link to from anywhere
 * else. Collapsed by default: somebody opening this page usually wants the
 * running balance, and a screen that answers the common question second is a
 * screen people learn to scroll past.
 */
export function AccountDetails({ account }: { account: AccountDto }) {
  const [open, setOpen] = useState(false);

  const rows: Array<{ label: string; value: string | null; copy?: boolean }> = [
    { label: "Type", value: ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type },
    { label: "Bank", value: account.bankName },
    { label: "Branch", value: account.branch },
    // Copyable, because these get typed into a bank's website and a
    // mistyped account number is a payment to a stranger.
    { label: "Account number", value: account.accountNumber, copy: true },
    { label: "Routing number", value: account.routingNumber, copy: true },
    { label: "SWIFT", value: account.swiftCode, copy: true },
    { label: "Currency", value: account.currency },
  ];

  const filled = rows.filter((r) => r.value);
  const blank = rows.filter((r) => !r.value);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition hover:bg-surface-muted"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Account details</p>
          <p className="truncate text-xs text-muted-foreground">
            {filled
              .slice(1, 4)
              .map((r) => r.value)
              .filter(Boolean)
              .join(" · ") || "Nothing recorded beyond the name"}
          </p>
        </div>
        {!account.isActive ? <Badge tone="warning">Archived</Badge> : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="border-t border-border px-5 py-4">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {filled.map((row) => (
              <Row key={row.label} label={row.label} copy={row.copy}>
                {row.value}
              </Row>
            ))}

            <Row label="Opened at">
              <Amount
                value={account.openingBalance}
                currency={account.currency}
                showCounterpart={false}
              />
              <span className="num text-muted-foreground">
                {" "}
                on {account.openingBalanceOn}
              </span>
            </Row>
          </dl>

          {account.notes ? (
            <div className="mt-4 border-t border-border pt-3">
              <dt className="text-xs font-medium text-muted-foreground">
                Notes
              </dt>
              <dd className="mt-1 text-sm whitespace-pre-wrap">
                {account.notes}
              </dd>
            </div>
          ) : null}

          {blank.length ? (
            // Named rather than silently absent. "SWIFT is empty" and "this
            // app has no SWIFT field" look identical when a row is simply not
            // drawn, and only one of them is something somebody can fix.
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              Not recorded: {blank.map((r) => r.label.toLowerCase()).join(", ")}.
              Edit the account to add them.
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Row({
  label,
  copy,
  children,
}: {
  label: string;
  copy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 sm:border-b-0 sm:pb-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium">
        {children}
        {copy && typeof children === "string" ? (
          <CopyButton value={children} />
        ) : null}
      </dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      aria-label={copied ? "Copied" : `Copy ${value}`}
      title={copied ? "Copied" : "Copy"}
      className="ml-1.5 cursor-pointer align-middle text-muted-foreground transition hover:text-foreground"
    >
      {copied ? (
        <Check className="inline size-3.5 text-positive" />
      ) : (
        <Copy className="inline size-3.5" />
      )}
    </button>
  );
}
