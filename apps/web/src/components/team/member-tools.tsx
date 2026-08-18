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
 * The status here is the plan's. A seat is a person and nothing else — the
 * date and the status are given once, when the tool is bought, and they cover
 * everybody on it. So a seat carries no status of its own to filter on, and
 * reading the one it was created with would drop every row into whichever
 * default it happened to get and leave three of these tabs permanently empty.
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
    () => (rows ?? []).filter((row) => tab === "all" || row.planStatus === tab),
    [rows, tab],
  );

  // Counted from everything, not from the tab — a tab reading "Active" with
  // nothing under it should still say how many there are elsewhere. Counted the
  // same way it is filtered, or a tab promises rows it cannot then show.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows ?? []) {
      map.set(row.planStatus, (map.get(row.planStatus) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  // Seats written before a seat became just a person still carry their own
  // dates, and those are a real record of who had what when. Nothing writes
  // them any more, so the column earns its width only while such rows exist —
  // asked of every row rather than the tab's, so the table does not change
  // shape underneath somebody switching tabs.
  const hasOwnDates = useMemo(
    () => (rows ?? []).some((row) => row.fromDate || row.untilDate),
    [rows],
  );

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
                {hasOwnDates ? (
                  <th
                    scope="col"
                    className="px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Their own dates
                  </th>
                ) : null}
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
                  {hasOwnDates ? (
                    <td className="px-3 py-2 text-sm">
                      <OwnDates from={row.fromDate} until={row.untilDate} />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <AccessPill status={row.planStatus} />
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

      {hasOwnDates ? (
        <p className="text-xs text-muted-foreground">
          Access runs with the plan, whose own dates are on the tool. The dates
          above are older per-person records, kept as they were written.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A window somebody was given back when a seat had dates of its own.
 *
 * Rendered as one range rather than two columns because it is history, not
 * something being kept up to date — and a half of it can be missing, which two
 * columns of em-dashes read as "we lost this" rather than "it was never
 * written". The plan's own start and renewal would be the honest fallback for
 * the missing half, but they are not on this row: `MemberSubscriptionDto`
 * carries the plan's status and nothing else of the plan's, so the Open link
 * is where a reader goes for them.
 */
function OwnDates({
  from,
  until,
}: {
  from: string | null;
  until: string | null;
}) {
  if (!from && !until) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {from ? (
        <span className="num">{from}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <span aria-hidden className="text-muted-foreground">
        →
      </span>
      <span className="sr-only">to</span>
      {until ? (
        <span className="num">{until}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </span>
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
