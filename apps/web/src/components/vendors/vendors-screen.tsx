"use client";

import {
  BILLING_CYCLE_HABIT_LABELS,
  PSR_STATUS_LABELS,
  VENDOR_TYPE_LABELS,
  formatMoney,
  isRecurringType,
  wasPaidInPeriod,
  type Paginated,
  type SubscriptionLine,
  type SubscriptionSummary,
} from "@finance/shared";
import {
  CircleCheck,
  CircleDashed,
  Plus,
  Search,
  SquarePen,
  Store,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useMoney } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { vendorsApi, type VendorDto } from "@/lib/masters";
import { cn, formatDate } from "@/lib/utils";
import { VendorForm } from "./vendor-form";

export function VendorsScreen({
  initialPage,
  summary,
}: {
  initialPage: Paginated<VendorDto>;
  summary: SubscriptionSummary;
}) {
  const router = useRouter();
  const canWrite = useCan("vendors.write");

  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VendorDto | null>(null);

  async function refresh(q = query) {
    setPage(
      await vendorsApi.list({
        pageSize: 50,
        includeInactive: true,
        q: q || undefined,
      }),
    );
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="AI tools and subscriptions"
        description="What the company uses, what it usually costs, and what was actually paid for it."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              Add
            </Button>
          ) : null
        }
      />

      <SpendStrip summary={summary} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
        className="relative flex max-w-sm items-center"
      >
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <label className="sr-only" htmlFor="vendor-search">
          Search vendors
        </label>
        <input
          id="vendor-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, contact, phone, or e-TIN"
          className={cn(controlClass, "pl-9")}
        />
      </form>

      {page.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Store className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              {query ? "Nothing matched that search" : "Nothing here yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {query
                ? "Try a shorter search, or add it as a new one."
                : "Add an AI tool, a subscription or anyone else you pay. Typing a new name while recording a payment also adds it here."}
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-data min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Usually</Th>
                  <Th className="text-right">Usual cost</Th>
                  <Th className="text-right">
                    Paid in {shortPeriod(summary.period.label)}
                  </Th>
                  <Th>Last paid</Th>
                  <Th className="text-right">{canWrite ? "" : null}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((vendor) => {
                  const line = lineFor(vendor.id, summary);
                  return (
                    <tr
                      key={vendor.id}
                      className={cn(
                        "row-finance hover:bg-surface-muted/50",
                        !vendor.isActive && "opacity-55",
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{vendor.name}</span>
                        {!vendor.isActive ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            inactive
                          </span>
                        ) : null}
                        {/* e-TIN and PSR only matter for somebody tax is
                            withheld from, which a SaaS bill abroad is not.
                            Kept, but out of the way of the columns that are
                            read every week. */}
                        {vendor.etin || vendor.bin ? (
                          <span className="num mt-0.5 block text-xs text-muted-foreground">
                            {vendor.etin ? `e-TIN ${vendor.etin}` : null}
                            {vendor.etin && vendor.bin ? " · " : null}
                            {vendor.bin ? `BIN ${vendor.bin}` : null}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {VENDOR_TYPE_LABELS[vendor.type]}
                        {!isRecurringType(vendor.type) &&
                        vendor.psrStatus !== "unknown" ? (
                          <span className="mt-0.5 block">
                            <PsrBadge status={vendor.psrStatus} />
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {vendor.billingCycle === "none"
                          ? "—"
                          : BILLING_CYCLE_HABIT_LABELS[vendor.billingCycle]}
                      </td>
                      <td className="col-amount px-4 py-2.5">
                        <UsualCost vendor={vendor} line={line} />
                      </td>
                      <td className="col-amount px-4 py-2.5">
                        <PaidCell line={line} />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {line?.lastPaidOn ? (
                          <span className="num text-sm">
                            {formatDate(line.lastPaidOn)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canWrite ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(vendor)}
                          >
                            <SquarePen className="size-3.5" />
                            Edit
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <VendorForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => refresh()}
      />
      <VendorForm
        key={editing?.id}
        open={Boolean(editing)}
        vendor={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => refresh()}
      />
    </>
  );
}

/** The tool line for a row, or undefined for a payee that is not a tool. */
function lineFor(id: string, summary: SubscriptionSummary) {
  return summary.lines.find((line) => line.id === id);
}

/** "August 2026" is too wide for a column head; the month alone is enough. */
function shortPeriod(label: string) {
  return label.split(" ")[0];
}

/**
 * The list price, in the currency it is charged in.
 *
 * Kept because "about $20 a month" is the thing somebody is checking against
 * when they look at what was actually paid. It is not converted to taka: the
 * rate on the day is what the ledger figure already reflects, and a second
 * conversion here would produce two numbers that never quite agree.
 */
function UsualCost({
  vendor,
  line,
}: {
  vendor: VendorDto;
  line: SubscriptionLine | undefined;
}) {
  if (!vendor.billingAmount) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="flex flex-col items-end">
      <span className="num text-sm">
        {formatMoney(vendor.billingAmount, {
          currency: vendor.billingCurrency,
          format: "western",
        })}
      </span>
      {line?.billingAccountName ? (
        <span className="text-xs text-muted-foreground">
          from {line.billingAccountName}
        </span>
      ) : null}
    </span>
  );
}

/**
 * What actually left the accounts for this tool this month.
 *
 * "Not yet" rather than a zero, and muted rather than warned: not buying
 * something this month is a normal outcome here, not a problem to fix. The
 * point of the column is to answer "have I bought Claude yet", not to nag.
 */
function PaidCell({ line }: { line: SubscriptionLine | undefined }) {
  const money = useMoney();

  if (!line) return <span className="text-muted-foreground">—</span>;

  if (!wasPaidInPeriod(line)) {
    // Sans, not the column's mono: it is a word, and mono makes words read as
    // code. The column stays right-aligned so the figures below it still line
    // up on the decimal.
    return (
      <span className="font-sans text-sm text-muted-foreground">Not yet</span>
    );
  }

  return (
    <span className="flex flex-col items-end">
      <span className="num text-sm font-medium">
        {money(line.paidThisPeriod)}
      </span>
      {line.entriesThisPeriod > 1 ? (
        <span className="text-xs text-muted-foreground">
          {line.entriesThisPeriod} payments
        </span>
      ) : null}
    </span>
  );
}

/**
 * What was spent on tooling this month, and which tools it went on.
 *
 * Every figure is the ledger's. There is deliberately no "committed each
 * month" total: these are bought month by month — some months yes, some months
 * no — so a projected commitment would assert spending that may never happen.
 */
function SpendStrip({ summary }: { summary: SubscriptionSummary }) {
  const money = useMoney();

  const bought = summary.lines.filter(wasPaidInPeriod);
  const notYet = summary.lines.filter((line) => !wasPaidInPeriod(line));

  // The headline counts everything settled on the card as tooling, named tool
  // or not — which is right, and also why it can exceed the tools listed
  // below. Saying so beats letting somebody add the column up and find a gap.
  const unattributed = Number(summary.unattributed) > 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Wallet className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Paid in {summary.period.label}
          </span>
          <span className="num block text-lg font-semibold">
            {money(summary.paidThisPeriod, { hideDecimals: true })}
          </span>
          {unattributed ? (
            <span className="block truncate text-xs text-muted-foreground">
              incl. {money(summary.unattributed, { hideDecimals: true })} not
              tied to a tool
            </span>
          ) : null}
        </span>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            bought.length
              ? "bg-positive/12 text-positive"
              : "bg-surface-muted text-muted-foreground",
          )}
        >
          <CircleCheck className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Bought this month
          </span>
          {/* Two lines, not one: this is the card somebody scans for a name,
              and a list that ends in an ellipsis cannot be scanned. */}
          <span className="line-clamp-2 block text-sm font-medium">
            {bought.length
              ? bought.map((line) => line.name).join(", ")
              : "Nothing yet"}
          </span>
        </span>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
          <CircleDashed className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Not yet this month
          </span>
          <span className="line-clamp-2 block text-sm font-medium">
            {notYet.length
              ? notYet.map((line) => line.name).join(", ")
              : "All of them bought"}
          </span>
        </span>
      </Card>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * Missing PSR raises the TDS rate by 50%, so an unchecked vendor is worth
 * flagging rather than showing as neutral.
 */
function PsrBadge({ status }: { status: VendorDto["psrStatus"] }) {
  const tone =
    status === "submitted"
      ? "positive"
      : status === "not_submitted"
        ? "negative"
        : "warning";
  return <Badge tone={tone}>{PSR_STATUS_LABELS[status]}</Badge>;
}
