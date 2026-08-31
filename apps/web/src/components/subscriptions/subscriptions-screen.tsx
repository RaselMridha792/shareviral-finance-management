"use client";

import {
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUS_TABS,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionCategory,
  type SubscriptionStatus,
} from "@finance/shared";
import { Image as Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { useSettings } from "@/components/settings-provider";
import {
  SubscriptionBodyCells,
  SubscriptionHeadCells,
} from "@/components/subscriptions/subscription-columns";
import { SubscriptionForm } from "@/components/subscriptions/subscription-form";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
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
  TickCell,
  TickHead,
} from "@/components/ui/table";
import { Select } from "@/components/ui/field";
import type { AccountDto } from "@/lib/masters";
import { serial } from "@/lib/pagination";
import type { TeamMemberDto } from "@/lib/payroll";
import { subscriptionsApi, type SubscriptionDto } from "@/lib/subscriptions";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ApiError, trashApi } from "@/lib/api-client";

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

  /**
   * Which plan's paperwork is open, and which half of it.
   *
   * A subscription is a money row like any other and carries the same two
   * documents — our bill and the bank's record of the charge — so the two
   * columns open different things rather than the same list twice.
   */
  const [documentsFor, setDocumentsFor] = useState<{
    row: SubscriptionDto;
    kinds: readonly string[];
  } | null>(null);
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

  const del = useRowDelete<SubscriptionDto>({
    kind: "subscription",
    subject: "subscription",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.toolName ?? row.planName}</span>
        <span className="text-xs text-muted-foreground">
          {row.planName} · {row.status} · renews {row.nextRenewalOn ?? "N/A"}
        </span>
      </div>
    ),
    consequences: (
      <p>
        The plan and its seats leave this screen, and nobody is reminded about
        its renewal again. The payments already recorded for it stay in the
        ledger — they are movements of money, and this row is only the
        arrangement behind them. If the plan is merely finished,{" "}
        <span className="font-medium text-foreground">cancel it instead</span>,
        which keeps its cost in this year&rsquo;s figures.
      </p>
    ),
    onDone: () => void load(),
  });

  /* Ticking, and the one act it leads to. Declared after the rows it
     prunes itself to. */
  const bulk = useBulkSelect(rows);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

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
            {/* Only when something is ticked; otherwise the screen is unchanged. */}
            <BulkBar
              count={bulk.count}
              noun="subscription"
              pending={bulkPending}
              onClear={bulk.clear}
              onTrash={() => {
                setBulkError(null);
                setBulkAsking(true);
              }}
            />
            <table className="table-data w-full min-w-[2064px]">
              <thead>
                <tr>
                  {bulk ? (
                    <TickHead
                      state={bulk.headerState}
                      onChange={bulk.allOnPage}
                    />
                  ) : null}
                  <SerialHead />
                  <SubscriptionHeadCells />
                  <RowActionsHead deletable={canWrite} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessageRow colSpan={19}>Loading…</TableMessageRow>
                ) : (
                  rows.map((row, index) => (
                    <tr key={row.id} className="row-finance">
                      {bulk ? (
                        <TickCell
                          checked={bulk.isTicked(row.id)}
                          onChange={() => bulk.toggle(row.id)}
                          label={row.toolName}
                        />
                      ) : null}
                      <SerialCell n={serial(page, index)} />
                      <SubscriptionBodyCells
                        row={row}
                        numberFormat={settings.numberFormat}
                        handlers={{
                          onInvoice: (r) =>
                            setDocumentsFor({ row: r, kinds: ["invoice"] }),
                          onReference: (r) =>
                            setDocumentsFor({
                              row: r,
                              kinds: ["bank_statement", "receipt", "other"],
                            }),
                          onScreenshot: setScreenshotOf,
                        }}
                      />
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
                        onDelete={canWrite ? () => del.ask(row) : undefined}
                      />
                    </tr>
                  ))
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

      {documentsFor ? (
        <DocumentsDialog
          owner="subscription"
          transactionId={documentsFor.row.id}
          refNo={documentsFor.row.invoiceNo ?? documentsFor.row.toolName}
          title={documentsFor.row.toolName}
          kinds={documentsFor.kinds}
          onClose={() => setDocumentsFor(null)}
        />
      ) : null}
      {del.dialog}

      <DeleteDialog
        open={bulkAsking}
        subject="subscription"
        count={bulk.count}
        summary={
          <>
            {bulk.selected
              .slice(0, 5)
              .map((row) => row.toolName)
              .join(", ")}
            {bulk.count > 5 ? ` and ${bulk.count - 5} more` : ""}
          </>
        }
        consequences="They come off the list. The tools stay in the register and the trash can put them back."
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(false)}
        onConfirm={(reason) => {
          setBulkPending(true);
          setBulkError(null);
          void trashApi
            .removeMany(
              "subscription",
              bulk.selected.map((row) => row.id),
              reason,
            )
            .then(() => {
              setBulkAsking(false);
              bulk.clear();
              void load();
            })
            .catch((err: unknown) =>
              setBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setBulkPending(false));
        }}
      />
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
