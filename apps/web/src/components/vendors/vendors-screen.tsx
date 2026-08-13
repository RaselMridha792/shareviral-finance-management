"use client";

import {
  BILLING_CYCLE_LABELS,
  PSR_STATUS_LABELS,
  VENDOR_TYPE_LABELS,
  isRecurringType,
  type Paginated,
  type SubscriptionSummary,
} from "@finance/shared";
import {
  CalendarClock,
  Plus,
  RefreshCw,
  Search,
  SquarePen,
  Store,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { vendorsApi, type VendorDto } from "@/lib/masters";
import { cn } from "@/lib/utils";
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
        title="Subscriptions"
        description="What the company pays for, and when each one comes round again."
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

      <SubscriptionSummaryStrip summary={summary} />

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
            <table className="table-data min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Every</Th>
                  <Th className="text-right">Cost</Th>
                  <Th>Next</Th>
                  <Th>Paid from</Th>
                  <Th className="text-right">{canWrite ? "" : null}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((vendor) => (
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
                        : BILLING_CYCLE_LABELS[vendor.billingCycle].replace(
                            "Every ",
                            "",
                          )}
                    </td>
                    <td className="col-amount px-4 py-2.5">
                      {vendor.billingAmount
                        ? `${vendor.billingCurrency === "USD" ? "$" : "৳"}${vendor.billingAmount}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <RenewalCell id={vendor.id} summary={summary} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {renewalLine(vendor.id, summary)?.billingAccountName ??
                        "—"}
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
                ))}
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

/** The rolled-forward line for a row, or undefined when it does not recur. */
function renewalLine(id: string, summary: SubscriptionSummary) {
  return summary.lines.find((line) => line.id === id);
}

/**
 * When it comes round again, and how close that is.
 *
 * A date on its own makes the reader do the arithmetic. "in 3 days" is the
 * part they came for; the date is there to confirm it.
 */
function RenewalCell({
  id,
  summary,
}: {
  id: string;
  summary: SubscriptionSummary;
}) {
  const line = renewalLine(id, summary);
  if (!line?.nextRenewalOn) {
    return <span className="text-muted-foreground">—</span>;
  }

  const days = line.daysAway ?? 0;
  const soon = days <= 7;

  return (
    <span className="flex flex-col">
      <span className="num text-sm">{line.nextRenewalOn}</span>
      <span
        className={cn(
          "text-xs",
          soon ? "font-medium text-warning" : "text-muted-foreground",
        )}
      >
        {days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}
      </span>
    </span>
  );
}

/**
 * What the company is committed to each month.
 *
 * Taka and dollars are shown side by side rather than added. Most AI tools
 * bill in dollars while the books are in taka; one combined figure would be
 * wrong by the exchange rate and look entirely normal — a mistake this app
 * has already made once, elsewhere.
 */
function SubscriptionSummaryStrip({
  summary,
}: {
  summary: SubscriptionSummary;
}) {
  const nothing =
    Number(summary.monthlyBdt) === 0 && Number(summary.monthlyUsd) === 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <RefreshCw className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Every month
          </span>
          <span className="num block text-lg font-semibold">
            {nothing ? "—" : null}
            {Number(summary.monthlyBdt) > 0
              ? `৳${Number(summary.monthlyBdt).toFixed(0)}`
              : null}
            {Number(summary.monthlyBdt) > 0 && Number(summary.monthlyUsd) > 0
              ? " + "
              : null}
            {Number(summary.monthlyUsd) > 0
              ? `$${Number(summary.monthlyUsd).toFixed(0)}`
              : null}
          </span>
        </span>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            summary.dueSoon.length
              ? "bg-warning/12 text-warning"
              : "bg-surface-muted text-muted-foreground",
          )}
        >
          <CalendarClock className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Renewing this week
          </span>
          <span className="block truncate text-sm font-medium">
            {summary.dueSoon.length
              ? summary.dueSoon.map((line) => line.name).join(", ")
              : "Nothing in the next 7 days"}
          </span>
        </span>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
          <Store className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Recurring
          </span>
          <span className="block text-lg font-semibold">
            {summary.lines.length}
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
