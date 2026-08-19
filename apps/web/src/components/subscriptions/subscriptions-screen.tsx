"use client";

import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUS_TABS,
  SUBSCRIPTION_STATUS_LABELS,
  formatMoney,
  type SubscriptionCategory,
  type SubscriptionStatus,
} from "@finance/shared";
import { Image as ImageIcon, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useSettings } from "@/components/settings-provider";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { ScreenshotDialog } from "@/components/subscriptions/screenshot-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState } from "@/components/ui/patterns";
import { Segmented } from "@/components/ui/segmented";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { Select } from "@/components/ui/field";
import type { AccountDto } from "@/lib/masters";
import { serial } from "@/lib/pagination";
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
export function SubscriptionsScreen({
  accounts,
  members,
}: {
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
  /**
   * Where in the register we are, and how long it is.
   *
   * `total` and `totalPages` are the envelope's figures, over the whole
   * filtered set — deliberately not `rows.length`, which is twenty on every
   * register that has more than twenty plans in it.
   */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<SubscriptionDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [screenshotOf, setScreenshotOf] = useState<SubscriptionDto | null>(
    null,
  );
  /** The plan whose status is in flight, so its button cannot be hit twice. */
  const [cycling, setCycling] = useState<string | null>(null);

  // A request per keystroke also lets a slower earlier response land after a
  // faster later one, so the table settles on the wrong search. Clearing the
  // pending timer means only the pause at the end of typing queries.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      // A new search is a new and usually shorter list, and page 4 of it may
      // not exist. Staying put would answer a search that has plenty of
      // matches with an empty table.
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  /**
   * Both filters go back to the first page.
   *
   * Page 3 of the active plans is not page 3 of the paused ones, and page 3 of
   * "every category" is usually past the end of "AI tools". Keeping the number
   * across a filter change lands on an empty table, which reads as "there are
   * none of these" when there is a full page 1 of them.
   */
  const changeTab = useCallback((next: SubscriptionStatus | "all") => {
    setTab(next);
    setPage(1);
  }, []);

  const changeCategory = useCallback((next: SubscriptionCategory | "") => {
    setCategory(next);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await subscriptionsApi.list({
        status: tab === "all" ? undefined : tab,
        category: category || undefined,
        q: query || undefined,
        page,
      });
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setError("Could not load the subscriptions.");
    } finally {
      setLoading(false);
    }
  }, [tab, category, query, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * The status button's one move.
   *
   * The plan leaves the list as often as not — a paused plan is not on the
   * Active tab — so this reloads rather than patching the row in place, and
   * the reload is what proves the write landed.
   */
  const cycleStatus = useCallback(
    async (row: SubscriptionDto) => {
      const next = nextStatus(row.status);
      setCycling(row.id);
      try {
        await subscriptionsApi.update(row.id, { status: next });
        await load();
      } catch {
        setError(
          `Could not move ${row.toolName} to ${SUBSCRIPTION_STATUS_LABELS[next].toLowerCase()}.`,
        );
      } finally {
        setCycling(null);
      }
    },
    [load],
  );

  const money = (value: string, currency: string) =>
    formatMoney(value, { currency, format: settings.numberFormat });

  /**
   * The seats on the plans currently on screen — which is now one page of them.
   *
   * There is no company-wide seat figure to ask the API for: seats arrive
   * attached to the plans of the page that was fetched, and nothing aggregates
   * them across the filtered set. So this stays a page figure and the sentence
   * under the table says which rows it counted, rather than adding up twenty
   * plans and presenting the answer as the company's.
   */
  const seats = useMemo(
    () => rows.reduce((total, row) => total + row.users.length, 0),
    [rows],
  );

  /**
   * The tool names the form offers under its name field.
   *
   * They come from the rows on screen because the register is now the only
   * place a tool's name is written down — there is no company list behind it
   * to ask any more, and fetching one purely to fill a datalist would put back
   * exactly what the owner had taken out.
   *
   * Folded case-insensitively: a tool entered twice, spelled two ways, is
   * offered once, and the suggestion is whichever spelling was seen first.
   *
   * Paged, these are the names on the current page rather than in the whole
   * register. The datalist is a shortcut and not a vocabulary — a name it does
   * not offer can still be typed — so that is a narrower list, not a wrong one.
   */
  const toolNames = useMemo(() => {
    const byName = new Map<string, string>();
    for (const row of rows) {
      const name = row.toolName.trim();
      if (name && !byName.has(name.toLowerCase()))
        byName.set(name.toLowerCase(), name);
    }
    return [...byName.values()].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  return (
    <>
      <PageHeader
        title="AI tools and subscriptions"
        icon="auto_awesome"
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
        {/* A filter over one list, so the design's segmented group rather than
            the underline row it had — underlines are for switching between
            documents, which these five are not. */}
        <Segmented
          options={SUBSCRIPTION_STATUS_TABS}
          value={tab}
          onChange={changeTab}
          label="Subscription status"
        />

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Tool, plan, team, login…"
          />
          <Select
            aria-label="Category"
            value={category}
            onChange={(e) =>
              changeCategory(e.target.value as SubscriptionCategory | "")
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

      {!loading && rows.length === 0 ? (
        /*
          Outside the table, not a cell inside it.

          A colSpan row centres itself in the table's 1808px min-width, which
          put "Nothing is active." three hundred pixels off the right edge of
          the screen — a message nobody could read, under sixteen empty
          columns.
        */
        <Card>
          <EmptyState
            icon="auto_awesome"
            title={
              tab === "all"
                ? "No subscriptions yet"
                : `Nothing is ${SUBSCRIPTION_STATUS_TABS.find((t) => t.id === tab)?.label.toLowerCase()}`
            }
          >
            {tab === "all"
              ? "Every paid plan the company runs goes here — what it costs, who is on it, and which card renews it."
              : "Try another status, or All."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableScroll>
            {/* SL, then fourteen columns in the order the owner reads them,
              then the unnamed cell the row's two buttons live in. Sixteen,
              which is what the message row below spans. */}
            <table className="table-data w-full min-w-[1808px]">
              <thead>
                <tr>
                  <SerialHead />
                  <Th>Start Date</Th>
                  <Th>Tool Name</Th>
                  <Th>Category</Th>
                  <Th align="right">Equivalent (BDT)</Th>
                  <Th align="right">Cost (USD)</Th>
                  <Th align="right">USD Rate</Th>
                  <Th>Payment Method</Th>
                  <Th>Notes</Th>
                  <Th>Login accounts</Th>
                  <Th>User Name</Th>
                  <Th>User Department</Th>
                  <Th>Billing Cycle</Th>
                  <Th>Next Renewal Date</Th>
                  <Th>Status</Th>
                  <RowActionsHead />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessageRow colSpan={16}>Loading…</TableMessageRow>
                ) : (
                  rows.map((row, index) => {
                    // Names rather than a headcount: the column is asked "who is
                    // on this", and a number does not answer it.
                    const seatNames = row.users
                      .map((seat) => seat.fullName)
                      .join(", ");

                    return (
                      <tr key={row.id} className="row-finance">
                        <SerialCell n={serial(page, index)} />
                        <td className="text-sm">
                          <span className="num">{row.startDate}</span>
                        </td>
                        <td>
                          {/* The name opens the screenshot — the request was that
                            clicking the tool shows the plan as it was bought. */}
                          <button
                            type="button"
                            onClick={() => setScreenshotOf(row)}
                            className="flex cursor-pointer items-center gap-1.5 text-left font-medium transition hover:text-primary"
                          >
                            {row.toolName}
                            {row.screenshotFileId ? (
                              <ImageIcon className="size-3 shrink-0 text-muted-foreground" />
                            ) : null}
                          </button>
                          {/* The plan rides under the name instead of taking a
                            column. Two plans of one tool are otherwise the
                            same row twice. */}
                          <span className="block text-xs text-muted-foreground">
                            {row.planName}
                          </span>
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {SUBSCRIPTION_CATEGORY_LABELS[row.category]}
                        </td>
                        <td className="col-amount">
                          {row.costBdt ? money(row.costBdt, "BDT") : "—"}
                        </td>
                        <td className="col-amount">
                          {money(row.costUsd, "USD")}
                        </td>
                        <td className="col-amount text-sm text-muted-foreground">
                          {row.usdRate ? Number(row.usdRate).toFixed(2) : "—"}
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {/* Opens the account itself — the card, its balance and
                            what else it pays for — rather than leaving the
                            reader to go and find it on the accounts list. */}
                          {row.accountName ? (
                            row.accountId ? (
                              <Link
                                href={`/accounts/${row.accountId}`}
                                className="transition hover:text-primary hover:underline"
                              >
                                {row.accountName}
                              </Link>
                            ) : (
                              row.accountName
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="text-sm text-muted-foreground">
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
                        <td className="text-sm text-muted-foreground">
                          {row.loginEmail ?? "—"}
                        </td>
                        <td className="text-sm">
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
                        <td className="text-sm text-muted-foreground">
                          {row.boughtFor ?? "—"}
                        </td>
                        <td className="text-sm text-muted-foreground">
                          {BILLING_CYCLE_LABELS[row.billingCycle]}
                        </td>
                        <td className="text-sm">
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
                        <td>
                          <StatusPill status={row.status} />
                        </td>
                        {/* Both buttons render for everybody. A reader
                          without write access gets them disabled: a blank
                          cell where every other row has controls reads as a
                          rendering fault, not as a permission. */}
                        <RowActions
                          onEdit={canWrite ? () => setEditing(row) : undefined}
                          second="status"
                          onSecond={
                            canWrite && cycling !== row.id
                              ? () => void cycleStatus(row)
                              : undefined
                          }
                        />
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {/* A sibling of the table and of the empty card, never inside either.
        The page somebody most needs this control on is the empty one they
        landed on when a filter narrowed the list under them, and a pager
        written inside the table branch is the one that is not there. */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="plan"
        onPage={setPage}
      />

      {rows.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {/* The plan count is the envelope's, so it counts the filtered
            register rather than the twenty rows above it. The seat count
            cannot be: seats come attached to the plans of this page and
            nothing sums them server-side, so it names the rows it counted
            instead of implying the company. */}
          {total} {total === 1 ? "plan" : "plans"},{" "}
          {rows.length < total
            ? `${seats} ${seats === 1 ? "seat" : "seats"} on the ${rows.length} shown here.`
            : `${seats} ${seats === 1 ? "seat" : "seats"} between them.`}{" "}
          What was actually paid for these is on the Expenses screens — these
          are the plans, not the payments.
        </p>
      ) : null}

      {adding ? (
        <SubscriptionForm
          open
          toolNames={toolNames}
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
          toolNames={toolNames}
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

/**
 * Where the status button takes a plan.
 *
 * A plan that is running gets paused; everything else — paused, cancelled,
 * expired — comes back on. Nothing here reaches cancelled or expired on
 * purpose: cancelling is a decision with a date behind it and belongs in the
 * form, and expiring is something that happens rather than something a button
 * does.
 */
function nextStatus(status: SubscriptionStatus): SubscriptionStatus {
  return status === "active" ? "paused" : "active";
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
