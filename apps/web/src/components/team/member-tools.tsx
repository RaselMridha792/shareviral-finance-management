"use client";

import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  formatMoney,
  type SubscriptionStatus,
} from "@finance/shared";
import { ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  subscriptionsApi,
  type MemberSubscriptionDto,
} from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

/**
 * Every paid tool this person is on, or has ever been on.
 *
 * The status here is the person's, not the plan's. Clickup can be perfectly
 * active as a subscription while this particular seat was cancelled in July,
 * and the two being the same field is how somebody ends up still being billed
 * for a leaver. Where the two disagree, the plan's is shown beside it.
 *
 * Five tabs, and the fifth is not a status — "All" is the absence of the
 * filter rather than a value of it.
 */
const TABS: { id: SubscriptionStatus | "all"; label: string }[] = [
  ...SUBSCRIPTION_STATUSES.map((status) => ({
    id: status,
    label: SUBSCRIPTION_STATUS_LABELS[status],
  })),
  { id: "all", label: "All" },
];

export function MemberTools({
  memberId,
  numberFormat,
}: {
  memberId: string;
  numberFormat: "bangladeshi" | "western";
}) {
  const [rows, setRows] = useState<MemberSubscriptionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SubscriptionStatus | "all">("active");

  useEffect(() => {
    let live = true;
    subscriptionsApi
      .forMember(memberId)
      .then((next) => {
        if (live) setRows(next);
      })
      .catch(() => {
        if (live) setError("Could not read the tools for this person.");
      });
    return () => {
      live = false;
    };
  }, [memberId]);

  // Filtered here rather than refetched: this is a dozen rows for one person,
  // and a request per tab would make switching between them slower than
  // reading them.
  const shown = useMemo(
    () => (rows ?? []).filter((row) => tab === "all" || row.status === tab),
    [rows, tab],
  );

  // Counted from everything, not from the tab — a tab reading "Active" with
  // nothing under it should still say how many there are elsewhere.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.status, (map.get(row.status) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  if (error) {
    return (
      <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
        {error}
      </p>
    );
  }

  if (!rows) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Looking…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Not on any paid tool. Seats are added from the subscription itself —{" "}
        <Link href="/subscriptions" className="text-primary hover:underline">
          AI tools and subscriptions
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Tool status for this person"
        className="tabs-scroll flex gap-1 border-b border-border"
      >
        {TABS.map((entry) => {
          const count =
            entry.id === "all" ? rows.length : (counts.get(entry.id) ?? 0);
          return (
            <button
              key={entry.id}
              role="tab"
              type="button"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === entry.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
              <span className="num ml-1.5 text-xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nothing {TABS.find((t) => t.id === tab)?.label.toLowerCase()} for this
          person.
        </p>
      ) : (
        <div className="table-scroll overflow-x-auto">
          <table className="table-data w-full">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Tool
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Plan cost
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  From
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Until
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Their access
                </th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.subscriptionId} className="row-finance">
                  <td className="px-3 py-2">
                    <span className="font-medium">{row.vendorName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.planName} ·{" "}
                      {BILLING_CYCLE_LABELS[row.billingCycle].toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-muted-foreground">
                    {SUBSCRIPTION_CATEGORY_LABELS[row.category]}
                  </td>
                  <td className="col-amount px-3 py-2">
                    {formatMoney(row.costUsd, {
                      currency: "USD",
                      format: numberFormat,
                    })}
                  </td>
                  <td className="num px-3 py-2 text-sm">
                    {row.fromDate ?? "—"}
                  </td>
                  <td className="num px-3 py-2 text-sm">
                    {row.untilDate ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <AccessPill status={row.status} />
                    {/* Only when the two differ. A seat that matches its plan
                        needs no second badge saying so. */}
                    {row.planStatus !== row.status ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        plan is{" "}
                        {SUBSCRIPTION_STATUS_LABELS[
                          row.planStatus
                        ].toLowerCase()}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href="/subscriptions"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open
                      <ExternalLink className="size-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The cost shown is the whole plan&apos;s, not this person&apos;s share —
        a thirteen-seat plan costs what it costs however many people are on it.
      </p>
    </div>
  );
}

function AccessPill({ status }: { status: SubscriptionStatus }) {
  const tone: Record<SubscriptionStatus, string> = {
    active: "bg-positive/10 text-positive",
    paused: "bg-warning/10 text-warning",
    canceled: "bg-negative/10 text-negative",
    expired: "bg-surface-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        tone[status],
      )}
    >
      {SUBSCRIPTION_STATUS_LABELS[status]}
    </span>
  );
}
