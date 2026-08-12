"use client";

import {
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type PendingItem,
} from "@finance/shared";
import {
  ArrowRight,
  Banknote,
  Landmark,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { Amount } from "@/components/money/amount";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { ExpenseSummary, LedgerSummary } from "@/lib/ledger";
import { cn } from "@/lib/utils";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  bank: Landmark,
  cash: Banknote,
  mobile_wallet: Smartphone,
};

type Balance = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
};

export function DashboardScreen({
  firstName,
  monthLabel,
  balances,
  current,
  previous,
  expenses,
  pending,
}: {
  firstName: string;
  monthLabel: string;
  balances: Balance[];
  /** Null for a role that may not see money — HR signs in here too. */
  current: LedgerSummary | null;
  previous: LedgerSummary | null;
  expenses: ExpenseSummary | null;
  pending: PendingItem[];
}) {
  // Base currency only. A USD account added to a BDT one at 1:1 produces a
  // figure that is wrong by the exchange rate and looks entirely normal.
  const base = balances[0]?.currency ?? "BDT";
  const inBase = balances.filter((account) => account.currency === base);
  const otherCurrencies = balances.length - inBase.length;
  const totalBalance = inBase
    .reduce((sum, account) => sum + Number(account.balance), 0)
    .toFixed(2);

  if (!current || !previous || !expenses) {
    return (
      <>
        <PageHeader
          title={`Welcome, ${firstName}`}
          description="Your work lives under Team."
        />
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Users className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Nothing to show here</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              This account does not have access to the company&apos;s financial
              figures. Everything you do need is in the sidebar.
            </p>
          </div>
          <Link
            href="/team"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Go to Team
            <ArrowRight className="size-3.5" />
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={`Where the money stands — ${monthLabel}.`}
      />

      {pending.length > 0 ? <PendingCard items={pending} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Money on hand"
          value={totalBalance}
          hint={
            otherCurrencies > 0
              ? `${inBase.length} in ${base}, ${otherCurrencies} in another currency`
              : `${balances.length} account${balances.length === 1 ? "" : "s"}`
          }
          icon={Wallet}
        />
        <Tile
          label="In this month"
          value={current.moneyIn}
          delta={percentChange(current.moneyIn, previous.moneyIn)}
          hint="vs last month"
          tone="in"
        />
        <Tile
          label="Out this month"
          value={current.moneyOut}
          delta={percentChange(current.moneyOut, previous.moneyOut)}
          invertDelta
          hint="vs last month"
          tone="out"
        />
        <Tile
          label="Net this month"
          value={current.net}
          hint={`${current.entries} entr${current.entries === 1 ? "y" : "ies"}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Where the money spent went"
            description={monthLabel}
            action={
              <Link
                href="/expenses"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                All expenses
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody>
            {expenses.groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing spent yet this month.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {expenses.groups.map((group) => {
                  const share =
                    (Number(group.total) / Number(expenses.total)) * 100;
                  return (
                    <li key={group.id}>
                      <Link
                        href={`/expenses/${group.slug}`}
                        className="block rounded-lg px-1 py-1 transition hover:bg-surface-muted"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ background: group.color }}
                            />
                            <span className="truncate font-medium">
                              {group.name}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-baseline gap-3">
                            <span className="num text-xs text-muted-foreground">
                              {share.toFixed(0)}%
                            </span>
                            <Amount
                              value={group.total}
                              tone="neutral"
                              className="text-sm font-medium"
                            />
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{
                              width: `${Math.max(share, 1)}%`,
                              background: group.color,
                            }}
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Accounts"
            description="Balance right now"
            action={
              <Link
                href="/accounts"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Manage
                <ArrowRight className="size-3" />
              </Link>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {balances.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No accounts yet. Add one to start recording money.
              </p>
            ) : (
              balances.map((account) => {
                const Icon = ICONS[account.type] ?? Landmark;
                return (
                  <Link
                    key={account.id}
                    href={`/accounts/${account.id}`}
                    className="flex items-center gap-3 rounded-lg px-1 py-1.5 transition hover:bg-surface-muted"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {account.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[account.type as AccountType] ??
                          account.type}
                      </span>
                    </span>
                    <Amount
                      value={account.balance}
                      currency={account.currency}
                      className="shrink-0 text-sm font-semibold"
                    />
                  </Link>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/**
 * What the company owes and has not yet paid or filed.
 *
 * Deliberately at the top and deliberately carrying figures: a deadline list
 * with no amounts is a calendar, and nobody acts on a calendar.
 */
function PendingCard({ items }: { items: PendingItem[] }) {
  const overdue = items.filter((item) => item.status === "overdue").length;

  return (
    <Card>
      <CardHeader
        title="Waiting on you"
        description={
          overdue > 0
            ? `${overdue} past the deadline`
            : "Nothing overdue — these are coming up"
        }
      />
      <CardBody className="flex flex-col gap-1">
        {items.map((item) => (
          <Link
            key={`${item.kind}-${item.dueOn}-${item.title}`}
            href={item.href}
            className="row-finance flex items-center gap-3 rounded-lg px-2 transition hover:bg-surface-muted"
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                item.status === "overdue"
                  ? "bg-negative"
                  : item.status === "due_soon"
                    ? "bg-warning"
                    : "bg-border",
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.detail}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className={cn(
                  "num block text-xs font-medium",
                  item.status === "overdue"
                    ? "text-negative"
                    : "text-muted-foreground",
                )}
              >
                {item.status === "overdue" ? "was due " : "due "}
                {item.dueOn}
              </span>
            </span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

function Tile({
  label,
  value,
  hint,
  delta,
  invertDelta = false,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  invertDelta?: boolean;
  tone?: "in" | "out" | "neutral";
  icon?: ComponentType<{ className?: string }>;
}) {
  const up = (delta ?? 0) >= 0;
  // For expenses, up is bad — the colour follows meaning, not direction.
  const good = invertDelta ? !up : up;
  const TrendIcon = up ? TrendingUp : TrendingDown;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <Amount
        value={value}
        tone={tone === "neutral" ? "auto" : tone}
        className="mt-3 block text-2xl font-semibold tracking-tight"
      />

      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined && delta !== null ? (
          <span
            className={cn(
              "num inline-flex items-center gap-1 font-medium",
              good ? "text-positive" : "text-negative",
            )}
          >
            <TrendIcon className="size-3.5" />
            {up ? "+" : "−"}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
    </Card>
  );
}

/** Null when there is no previous figure — "+100%" from zero is meaningless. */
function percentChange(current: string, previous: string): number | null {
  const before = Number(previous);
  if (before === 0) return null;
  return ((Number(current) - before) / before) * 100;
}
