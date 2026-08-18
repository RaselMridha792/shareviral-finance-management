"use client";

import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  formatMoney,
  type SubscriptionCategory,
  type SubscriptionStatus,
} from "@finance/shared";
import { Image as ImageIcon, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useSettings } from "@/components/settings-provider";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { ScreenshotDialog } from "@/components/subscriptions/screenshot-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/field";
import type { AccountDto, VendorDto } from "@/lib/masters";
import type { TeamMemberDto } from "@/lib/payroll";
import { subscriptionsApi, type SubscriptionDto } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

/**
 * The register of paid tools — one row per plan, not per payment.
 *
 * Five tabs, and the fifth is not a status. "All" is the absence of the filter
 * rather than a value of it; a status called "all" is the kind of thing that
 * ends up in a database column a year later.
 *
 * Nothing here is totalled. What a tool actually cost comes from the ledger,
 * where every other figure in this app comes from — a stored renewal date is a
 * habit rather than a schedule, and a monthly total built from one would
 * assert spending that may never have happened.
 */
const TABS: { id: SubscriptionStatus | "all"; label: string }[] = [
  ...SUBSCRIPTION_STATUSES.map((status) => ({
    id: status,
    label: SUBSCRIPTION_STATUS_LABELS[status],
  })),
  { id: "all", label: "All" },
];

export function SubscriptionsScreen({
  vendors,
  accounts,
  members,
}: {
  vendors: VendorDto[];
  accounts: AccountDto[];
  members: TeamMemberDto[];
}) {
  const settings = useSettings();
  const canWrite = useCan("vendors.write");

  const [tab, setTab] = useState<SubscriptionStatus | "all">("active");
  const [category, setCategory] = useState<SubscriptionCategory | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SubscriptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SubscriptionDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [screenshotOf, setScreenshotOf] = useState<SubscriptionDto | null>(
    null,
  );

  // A request per keystroke also lets a slower earlier response land after a
  // faster later one, so the table settles on the wrong search. Clearing the
  // pending timer means only the pause at the end of typing queries.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await subscriptionsApi.list({
        status: tab === "all" ? undefined : tab,
        category: category || undefined,
        q: query || undefined,
      });
      setRows(page.items);
    } catch {
      setError("Could not load the subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [tab, category, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const money = (value: string, currency: string) =>
    formatMoney(value, { currency, format: settings.numberFormat });

  // Counted from what is on screen, and labelled as such. A count that claimed
  // to be the whole register while showing one page of it would be worse than
  // no count at all.
  const seats = useMemo(
    () => rows.reduce((total, row) => total + row.users.length, 0),
    [rows],
  );

  return (
    <>
      <PageHeader
        title="AI tools and subscriptions"
        description="Every paid plan, what it costs, who is on it, and which card renews it."
        actions={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add a subscription
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="tablist"
          aria-label="Subscription status"
          className="tabs-scroll flex gap-1 border-b border-border"
        >
          {TABS.map((entry) => (
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
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Plan, company, team, login…"
          />
          <Select
            aria-label="Category"
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as SubscriptionCategory | "")
            }
            className="w-48"
          >
            <option value="">Every category</option>
            {Object.entries(SUBSCRIPTION_CATEGORY_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="table-scroll overflow-x-auto">
          {/* Fourteen columns in the order the owner reads them, then one
              unnamed cell for the pencil. */}
          <table className="table-data w-full min-w-[1760px]">
            <thead>
              <tr>
                <Th>Tool Name</Th>
                <Th>Category</Th>
                <Th align="right">Cost (USD)</Th>
                <Th align="right">Equivalent (BDT)</Th>
                <Th align="right">USD Rate</Th>
                <Th>Billing Cycle</Th>
                <Th>Start Date</Th>
                <Th>Next Renewal Date</Th>
                <Th>Status</Th>
                <Th>Payment Method</Th>
                <Th>User Department</Th>
                <Th>User Name</Th>
                <Th>Notes</Th>
                <Th>Login accounts</Th>
                <Th align="right"> </Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={15}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={15}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    {tab === "all"
                      ? "Nothing here yet."
                      : `Nothing is ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}.`}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  // Names rather than a headcount: the column is asked "who is
                  // on this", and a number does not answer it.
                  const seatNames = row.users
                    .map((seat) => seat.fullName)
                    .join(", ");

                  return (
                    <tr key={row.id} className="row-finance">
                      <td className="px-4 py-2">
                        {/* The name opens the screenshot — the request was that
                            clicking the tool shows the plan as it was bought. */}
                        <button
                          type="button"
                          onClick={() => setScreenshotOf(row)}
                          className="flex cursor-pointer items-center gap-1.5 text-left font-medium transition hover:text-primary"
                        >
                          {row.vendorName}
                          {row.screenshotFileId ? (
                            <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                          ) : null}
                        </button>
                        {/* The plan rides under the name instead of taking a
                            column. Two plans of one vendor are otherwise the
                            same row twice. */}
                        <span className="block text-xs text-muted-foreground">
                          {row.planName}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {SUBSCRIPTION_CATEGORY_LABELS[row.category]}
                      </td>
                      <td className="col-amount px-4 py-2">
                        {money(row.costUsd, "USD")}
                      </td>
                      <td className="col-amount px-4 py-2">
                        {row.costBdt ? money(row.costBdt, "BDT") : "—"}
                      </td>
                      <td className="col-amount px-4 py-2 text-sm text-muted-foreground">
                        {row.usdRate ? Number(row.usdRate).toFixed(2) : "—"}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {BILLING_CYCLE_LABELS[row.billingCycle]}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        <span className="num">{row.startDate}</span>
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {row.nextRenewalOn ? (
                          <span className="num">{row.nextRenewalOn}</span>
                        ) : (
                          /* The note cannot be typed any more, but rows written
                             while it could still carry one, and it is the only
                             thing this column has to say about them. */
                          <span className="text-muted-foreground">
                            {row.renewalNote ?? "—"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {row.accountName ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {row.boughtFor ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {seatNames ? (
                          // Clamped, with the whole list on hover, so a plan
                          // with six seats does not stretch every row past it.
                          <span
                            title={seatNames}
                            className="block max-w-[14rem] truncate"
                          >
                            {seatNames}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {row.notes ? (
                          <span
                            title={row.notes}
                            className="block max-w-[16rem] truncate"
                          >
                            {row.notes}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground">
                        {row.loginEmail ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            aria-label={`Edit ${row.vendorName} ${row.planName}`}
                            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "plan" : "plans"} shown, {seats}{" "}
          {seats === 1 ? "seat" : "seats"} between them. What was actually paid
          for these is on the Expenses screens — these are the plans, not the
          payments.
        </p>
      ) : null}

      {adding ? (
        <SubscriptionForm
          open
          vendors={vendors}
          accounts={accounts}
          members={members}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <SubscriptionForm
          open
          subscription={editing}
          vendors={vendors}
          accounts={accounts}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {screenshotOf ? (
        <ScreenshotDialog
          subscription={screenshotOf}
          canWrite={canWrite}
          onClose={() => setScreenshotOf(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

/**
 * Cancelled and expired are not the same thing and do not look the same.
 *
 * One is a decision somebody made; the other is what happened when nobody
 * renewed. A screen asked "what did we cancel this quarter" has to be able to
 * tell them apart at a glance.
 */
function StatusPill({ status }: { status: SubscriptionStatus }) {
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
