"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { PauseCircleIcon } from "@phosphor-icons/react/dist/ssr/PauseCircle";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { TrayIcon } from "@phosphor-icons/react/dist/ssr/Tray";
import { XCircleIcon } from "@phosphor-icons/react/dist/ssr/XCircle";
import { todayInDhaka } from "@finance/shared";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useCan } from "@/components/auth/session-provider";
import { PayDrawer } from "@/components/hr-budget/hr-budget-drawers";
import { DecisionDrawer } from "@/components/hr-requests/decision-drawer";
import {
  payChangeCase,
  reachesNoMonth,
} from "@/components/hr-requests/pay-change-case";
import { useMoney } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/patterns";
import { RowDetails, rowOpener } from "@/components/ui/row-details";
import { RowButton } from "@/components/ui/row-actions";
import { SearchField } from "@/components/ui/search-field";
import { Segmented } from "@/components/ui/segmented";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
  TickCell,
  TickHead,
} from "@/components/ui/table";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { useToast } from "@/components/ui/toast";
import { ApiError, trashApi } from "@/lib/api-client";
import {
  KIND_LABELS,
  hrRequestsApi,
  type Decision,
  type HrRequestDetailDto,
  type HrRequestDto,
  type RequestKind,
  type StateFilter,
} from "@/lib/hr-requests";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { serial } from "@/lib/pagination";
import { formatDate } from "@/lib/utils";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The day a moment fell on in Dhaka, as the app writes dates. Not the first
 * ten characters of the ISO string: that is the UTC day, and anything after
 * six in the evening UTC is already tomorrow here.
 */
function dhakaDay(at: string): string {
  return formatDate(todayInDhaka(new Date(at)));
}

/** When it takes effect, as a person says it. */
/** The trash registry's kind for each kind of request. */
const TRASH_KIND: Record<RequestKind, string> = {
  pay_change: "hr-pay-change",
  one_off: "hr-one-off",
  budget: "hr-budget",
  spend: "hr-spend",
};

/**
 * Whether a request may go to the trash: only a decided one (the owner's
 * choice, 6 Nov 2026). Waiting or held, the HR portal is waiting to hear; a
 * spend approved and not yet paid still has money to move. The server's
 * `blockedWhen` says the same.
 */
function canTrash(row: HrRequestDto): boolean {
  if (row.state === "pending" || row.state === "held") return false;
  if (row.kind === "spend" && row.state === "approved" && !row.paid)
    return false;
  return true;
}

function takesEffect(row: HrRequestDto): string {
  if (row.kind === "one_off") {
    const [year, month] = row.effectiveOn.split("-").map(Number);
    return `${MONTHS[month - 1]} ${year} sheet`;
  }
  return formatDate(row.effectiveOn);
}

function StateBadge({ row }: { row: HrRequestDto }) {
  if (row.beforeApprovals) return <Badge tone="neutral">Applied earlier</Badge>;
  switch (row.state) {
    case "pending":
      return <Badge tone="warning">Waiting</Badge>;
    case "held":
      return <Badge tone="primary">On hold</Badge>;
    case "approved":
      return (
        <Badge tone="positive">
          {row.kind === "spend" ? (row.paid ? "Paid" : "To pay") : "Approved"}
        </Badge>
      );
    case "rejected":
      return <Badge tone="negative">Rejected</Badge>;
    case "withdrawn":
      return <Badge tone="neutral">Withdrawn by HR</Badge>;
  }
}

/**
 * HR Requests — every money request from the HR portal, and finance's
 * answer (#125).
 *
 * The owner, 30 Sep 2026: *"ami cai Finance a amon ekta page thakbe jetay
 * HRIS theke asa sob taka related request gula sundor vabe table a dekhabe.
 * table a click kore popup a details a dekhte parbe. se popup theke or table
 * theke status update kore dite parbe — like aprove, reject, hold — and tar
 * nijer note add korte parbe"*.
 *
 * One table for the four kinds — pay changes, one-offs, budgets, spends —
 * opening on what waits, oldest first, because it is the work: a salary
 * sheet cannot be built while a pay change or a one-off for its month waits.
 * A row opens everything HR sent, where it lands, and what has been done with
 * it; the decision is the same drawer from the row or the pop-up. Only an
 * approval moves anything, and an applied one is not taken back.
 *
 * A spend has one more step (3 Oct 2026): approving it asks whoever may pay
 * whether to pay it now, and one paid later waits on To pay — the spends
 * approved and not yet paid. Approved still lists every approval, paid or
 * not.
 */
export function HrRequestsScreen({
  initial,
  accounts,
  categories,
}: {
  initial: {
    kind?: RequestKind;
    state?: StateFilter;
    month?: string;
    open?: string;
  };
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canDecide = useCan("hrrequests.decide");
  /* Paying writes an expense, so it needs the ledger's permission too. */
  const canManageBudget = useCan("hrbudget.manage");
  const canWriteLedger = useCan("transactions.write");
  const canPay = canManageBudget && canWriteLedger;
  const money = useMoney();
  const toast = useToast();

  const [state, setState] = useState<StateFilter>(initial.state ?? "waiting");
  const [kind, setKind] = useState<RequestKind | "">(initial.kind ?? "");
  const [month, setMonth] = useState(initial.month ?? "");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HrRequestDto[]>([]);
  const [counts, setCounts] = useState({
    waiting: 0,
    to_pay: 0,
    approved: 0,
    rejected: 0,
    withdrawn: 0,
    all: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<{
    row: HrRequestDto;
    detail: HrRequestDetailDto | null;
  } | null>(null);
  const [deciding, setDeciding] = useState<{
    row: HrRequestDto;
    decision: Decision;
  } | null>(null);
  /* `justApproved`: opened by Pay now, straight after the approval. */
  const [paying, setPaying] = useState<{
    row: HrRequestDto;
    justApproved: boolean;
  } | null>(null);

  /*
   * Ticking and the trash (the owner, 6 Nov 2026: "HR request page tate
   * sobkichui select, delete jeno kora jay"), as every other table has them.
   * Decided requests only (`canTrash`); deleting one hides it here and
   * nothing else — what it changed stays changed, and the HR portal still
   * hears its decision.
   */
  const canDelete = canDecide;
  const bulk = useBulkSelect(rows);
  const [bulkAsking, setBulkAsking] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HrRequestDto | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await hrRequestsApi.list({
        page,
        state,
        kind: kind || undefined,
        month: month || undefined,
        q: query || undefined,
      });
      setRows(result.items);
      setCounts(result.counts);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the requests.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, state, kind, month, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const open = useCallback(async (row: HrRequestDto) => {
    setShowing({ row, detail: null });
    try {
      const detail = await hrRequestsApi.get(row.kind, row.id);
      setShowing((current) =>
        current && current.row.id === row.id
          ? { row: detail, detail }
          : current,
      );
    } catch {
      /* The row itself is still shown; the extras just are not. */
    }
  }, []);

  /* A link from the salary sheet's warning, or the bell, opens its row. */
  useEffect(() => {
    if (!initial.open || !initial.kind) return;
    const kindToOpen = initial.kind;
    void hrRequestsApi
      .get(kindToOpen, initial.open)
      .then((detail) => setShowing({ row: detail, detail }))
      .catch(() => undefined);
  }, [initial.open, initial.kind]);

  const summaryOf = (row: HrRequestDto) =>
    `${KIND_LABELS[row.kind]} · ${row.subject} · ${money(row.amount)}`;

  /** What can be done with it now, as buttons — for the row, or the pop-up. */
  const actions = (row: HrRequestDto, inPopup = false): ReactNode[] => {
    /* Nothing to decide on what HR took back, or on pay applied before
       approvals existed. */
    if (!canDecide || row.beforeApprovals || row.state === "withdrawn")
      return [];
    const waiting = row.state === "pending" || row.state === "held";
    const applied =
      row.state === "approved" &&
      (row.kind === "pay_change" ||
        (row.kind === "one_off" && row.appliedAt !== null) ||
        (row.kind === "spend" && row.paid));
    const decide = (decision: Decision) => {
      setShowing(null);
      setDeciding({ row, decision });
    };
    const make = (
      key: string,
      label: string,
      icon: typeof CheckCircleIcon,
      onClick: () => void,
      variant: "primary" | "secondary" | "ghost" = "secondary",
      tone?: "danger",
    ) =>
      inPopup ? (
        <Button
          key={key}
          variant={variant}
          size="sm"
          onClick={onClick}
          data-hrr-action={key}
        >
          {(() => {
            const Icon = icon;
            return <Icon weight="duotone" size={16} />;
          })()}
          {label}
        </Button>
      ) : (
        <RowButton
          key={key}
          label={`${label}: ${row.subject}`}
          title={label}
          icon={icon}
          tone={tone}
          onClick={onClick}
        />
      );

    const buttons: ReactNode[] = [];
    if (waiting) {
      buttons.push(
        make(
          "approve",
          "Approve",
          CheckCircleIcon,
          () => decide("approved"),
          "primary",
        ),
      );
      if (row.state === "pending") {
        buttons.push(
          make("hold", "Hold", PauseCircleIcon, () => decide("held")),
        );
      }
      buttons.push(
        make(
          "reject",
          "Reject",
          XCircleIcon,
          () => decide("refused"),
          "secondary",
          "danger",
        ),
      );
    }
    if (
      row.kind === "spend" &&
      row.state === "approved" &&
      !row.paid &&
      canPay
    ) {
      buttons.push(
        make(
          "pay",
          "Pay",
          HandCoinsIcon,
          () => {
            setShowing(null);
            setPaying({ row, justApproved: false });
          },
          "primary",
        ),
      );
    }
    if (inPopup && !waiting && !applied) {
      buttons.push(
        make(
          "back",
          "Put back to waiting",
          ArrowCounterClockwiseIcon,
          () => decide("received"),
          "ghost",
        ),
      );
    }
    return buttons;
  };

  const columns = canDelete ? 11 : 10;
  const shown = showing?.detail;

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="HR Requests"
        icon={TrayIcon}
        description="Every money request from the HR portal — pay changes, one-offs, budgets, spends. Nothing moves until it is approved."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Which requests"
          value={state}
          onChange={(next) => {
            setState(next);
            setPage(1);
          }}
          options={[
            { id: "waiting", label: "Waiting", count: counts.waiting },
            { id: "to_pay", label: "To pay", count: counts.to_pay },
            { id: "approved", label: "Approved", count: counts.approved },
            { id: "rejected", label: "Rejected", count: counts.rejected },
            { id: "withdrawn", label: "Withdrawn", count: counts.withdrawn },
            { id: "all", label: "All", count: counts.all },
          ]}
        />
        <Select
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as RequestKind | "");
            setPage(1);
          }}
          aria-label="Kind"
          className="h-11 w-auto min-w-[150px]"
          data-hrr-filter="kind"
        >
          <option value="">Every kind</option>
          {(Object.keys(KIND_LABELS) as RequestKind[]).map((one) => (
            <option key={one} value={one}>
              {KIND_LABELS[one]}
            </option>
          ))}
        </Select>
        <Input
          type="month"
          value={month}
          onChange={(event) => {
            setMonth(event.target.value);
            setPage(1);
          }}
          aria-label="Month it takes effect"
          className="h-11 w-auto"
          data-hrr-filter="month"
        />
        {month ? (
          <Button variant="ghost" size="sm" onClick={() => setMonth("")}>
            Every month
          </Button>
        ) : null}
        <div className="ml-auto">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Person, purpose, who asked…"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={TrayIcon}
            title={
              state === "waiting"
                ? "Nothing waiting"
                : state === "to_pay"
                  ? "Nothing to pay"
                  : "Nothing here"
            }
          >
            {state === "waiting" && !kind && !month && !query
              ? "Every request from HR has been decided. A new one — a raise, a one-off, a budget or a spend — arrives here, and rings the bell."
              : state === "to_pay" && !kind && !month && !query
                ? "Every approved spend has been paid. A spend approved and paid later waits here until it is."
                : "Try another state, kind or month, or clear the search."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          {canDelete ? (
            <BulkBar
              count={bulk.count}
              noun="request"
              pending={bulkPending}
              onClear={bulk.clear}
              onTrash={() => {
                setBulkError(null);
                setBulkAsking(true);
              }}
            />
          ) : null}
          <TableScroll>
            <table className="table-data w-full min-w-[1040px]">
              <thead>
                <tr>
                  {canDelete ? (
                    <TickHead
                      state={bulk.headerState}
                      onChange={bulk.allOnPage}
                    />
                  ) : null}
                  <SerialHead />
                  <Th>Kind</Th>
                  <Th>About</Th>
                  <Th align="right">Amount</Th>
                  <Th>Takes effect</Th>
                  <Th>Asked by</Th>
                  <Th>Received</Th>
                  <Th>State</Th>
                  <Th>Decided by</Th>
                  <Th width="w-32" align="right" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessageRow colSpan={columns}>Loading…</TableMessageRow>
                ) : (
                  rows.map((row, index) => (
                    <tr
                      key={`${row.kind}-${row.id}`}
                      className="row-finance"
                      data-hrr-row={row.id}
                      {...rowOpener(() => void open(row), row.id)}
                    >
                      {canDelete ? (
                        <TickCell
                          checked={bulk.isTicked(row.id)}
                          onChange={() => bulk.toggle(row.id)}
                          label={row.subject}
                        />
                      ) : null}
                      <SerialCell n={serial(page, index)} />
                      <td className="text-sm whitespace-nowrap">
                        {KIND_LABELS[row.kind]}
                      </td>
                      <td className="max-w-[240px]">
                        <span
                          className="block truncate font-extrabold"
                          title={row.subject}
                        >
                          {row.subject}
                        </span>
                        {row.detail ? (
                          <span
                            className="block truncate text-[12px] text-muted-foreground"
                            title={row.detail}
                          >
                            {row.detail}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-right font-extrabold whitespace-nowrap tabular-nums">
                        {money(row.amount)}
                      </td>
                      <td className="text-sm whitespace-nowrap tabular-nums">
                        {takesEffect(row)}
                      </td>
                      <td className="max-w-[150px] text-sm">
                        <span className="block truncate">
                          {row.requestedByName ?? "HR"}
                        </span>
                        {row.hrApprovedByName ? (
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            HR: {row.hrApprovedByName}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-sm whitespace-nowrap tabular-nums">
                        {dhakaDay(row.receivedAt)}
                      </td>
                      <td>
                        <StateBadge row={row} />
                      </td>
                      <td className="max-w-[130px] truncate text-sm text-muted-foreground">
                        {row.beforeApprovals
                          ? "Nobody"
                          : (row.decidedByName ?? "")}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {actions(row)}
                          {canDelete && canTrash(row) ? (
                            <RowButton
                              label={`Move to trash: ${row.subject}`}
                              title="Move to trash"
                              icon={TrashIcon}
                              tone="danger"
                              onClick={() => {
                                setRemoveError(null);
                                setRemoving(row);
                              }}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="request"
        onPage={setPage}
      />

      <RowDetails
        open={Boolean(showing)}
        onClose={() => setShowing(null)}
        title={
          showing
            ? `${KIND_LABELS[showing.row.kind]} — ${showing.row.subject}`
            : ""
        }
        description={
          showing
            ? `${money(showing.row.amount)} · ${takesEffect(showing.row)}`
            : undefined
        }
        footer={showing ? actions(showing.row, true) : undefined}
        sections={
          showing ? detailSections(showing.row, shown ?? null, money) : []
        }
      />

      {deciding ? (
        <DecisionDrawer
          key={`${deciding.row.id}-${deciding.decision}`}
          request={deciding.row}
          decision={deciding.decision}
          summary={summaryOf(deciding.row)}
          onClose={() => setDeciding(null)}
          onStale={() => void load()}
          onDone={(notice) => {
            const word = {
              approved:
                deciding.row.kind === "spend"
                  ? "Approved. It is on To pay until it is paid"
                  : "Approved",
              refused: "Rejected",
              held: "Put on hold",
              received: "Put back to waiting",
            }[deciding.decision];
            toast.show(notice ? `${word}. ${notice}` : `${word}.`, "success");
            setDeciding(null);
            void load();
          }}
          /* Only a spend has anything to pay, and only for whoever may. */
          onPayNow={
            deciding.row.kind === "spend" && canPay
              ? (approved) => {
                  setDeciding(null);
                  setPaying({ row: approved, justApproved: true });
                  void load();
                }
              : undefined
          }
        />
      ) : null}

      {paying ? (
        <PayDrawer
          key={paying.row.id}
          spend={{
            id: paying.row.id,
            amount: paying.row.amount,
            purpose: paying.row.subject,
          }}
          accounts={accounts}
          categories={categories}
          onClose={() => {
            /* Approved a moment ago and not paid after all: say where it
               went, so nobody reads the approval as lost. */
            if (paying.justApproved) {
              toast.show("Approved, not paid yet. It is on To pay.", "success");
            }
            setPaying(null);
          }}
          onDone={() => {
            setPaying(null);
            void load();
          }}
        />
      ) : null}

      <DeleteDialog
        open={Boolean(removing)}
        subject={removing ? KIND_LABELS[removing.kind].toLowerCase() : "request"}
        summary={removing ? summaryOf(removing) : null}
        consequences={TRASH_CONSEQUENCES}
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={(reason) => {
          if (!removing) return;
          setRemovePending(true);
          setRemoveError(null);
          void trashApi
            .remove(TRASH_KIND[removing.kind], removing.id, reason)
            .then(() => {
              setRemoving(null);
              void load();
            })
            .catch((caught: unknown) =>
              setRemoveError(
                caught instanceof ApiError
                  ? caught.message
                  : "That did not work.",
              ),
            )
            .finally(() => setRemovePending(false));
        }}
      />

      <DeleteDialog
        open={bulkAsking}
        subject="request"
        count={bulk.count}
        summary={
          <>
            {bulk.selected
              .slice(0, 5)
              .map((row) => row.subject)
              .join(", ")}
            {bulk.count > 5 ? ` and ${bulk.count - 5} more` : ""}
          </>
        }
        consequences={TRASH_CONSEQUENCES}
        pending={bulkPending}
        error={bulkError}
        onCancel={() => setBulkAsking(false)}
        onConfirm={(reason) => {
          /*
           * All or nothing. The four kinds go in four calls, so a request
           * still to decide is named here, before any of them, rather than
           * found by the server after the first kind has already gone.
           */
          const undecided = bulk.selected.filter((row) => !canTrash(row));
          if (undecided.length > 0) {
            setBulkError(
              `${undecided.map((row) => row.subject).join(", ")} ${undecided.length === 1 ? "is" : "are"} still to decide or to pay. Untick ${undecided.length === 1 ? "it" : "them"}, or decide ${undecided.length === 1 ? "it" : "them"} first.`,
            );
            return;
          }
          const byKind = new Map<RequestKind, string[]>();
          for (const row of bulk.selected) {
            byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.id]);
          }
          setBulkPending(true);
          setBulkError(null);
          void (async () => {
            try {
              for (const [one, ids] of byKind) {
                await trashApi.removeMany(TRASH_KIND[one], ids, reason);
              }
              setBulkAsking(false);
              bulk.clear();
              /* Back a page when this one just emptied. */
              if (bulk.count >= rows.length && page > 1) setPage(page - 1);
              else void load();
            } catch (caught) {
              setBulkError(
                caught instanceof ApiError
                  ? caught.message
                  : "That did not work.",
              );
              void load();
            } finally {
              setBulkPending(false);
            }
          })();
        }}
      />
    </>
  );
}

/** What moving an HR request to the trash does, and does not, do. */
const TRASH_CONSEQUENCES = (
  <p>
    It leaves this list and Settings → Trashed can put it back. Nothing it
    did is undone: a salary it changed, a budget it opened and money it paid
    all stay, and the HR portal still sees the decision. Only a decided
    request can go, and it stays in the trash rather than being removed for
    good.
  </p>
);

/**
 * A pay change's salary, in three figures and no more: Joining salary,
 * Current salary, New salary (the owner, 6 Nov 2026: "joining salary:
 * Current Salary: New Salary: er ceye beshi kichu likhle guliye felche
 * Finance"). They replaced "In force the day before", "On file for that
 * date" and "Paid today", which between them read as old and new at once.
 *
 * Current is what the new figure replaces: approved, the figure in force the
 * day before; still to decide, the one on file for that date. Only while it
 * waits is what approving would do said in words (`payChangeCase`): the same
 * figure already on file from that date (the salary record is left as it
 * is), the same figure from earlier (a record of its own, pay unchanged), a
 * later change in the same month (the figure reaches no sheet), and a date
 * before a later change, where the approved figure stops at that change.
 */
function payFigures(
  row: HrRequestDto,
  detail: HrRequestDetailDto | null,
  money: (value: string | number) => string,
): { label: string; value: ReactNode; block?: boolean }[] {
  const amount = (value: string | null | undefined) =>
    detail ? (value ? money(value) : "None on record") : "…";
  const current =
    row.state === "approved" ? detail?.previousAmount : detail?.onFileAmount;
  const figures: { label: string; value: ReactNode; block?: boolean }[] = [
    { label: "Joining salary", value: amount(detail?.joiningAmount) },
    { label: "Current salary", value: amount(current) },
    { label: "New salary", value: money(row.amount) },
  ];
  if (!detail || (row.state !== "pending" && row.state !== "held"))
    return figures;

  const approving = payChangeCase(detail);
  const note =
    approving.kind === "same-date"
      ? "The salary on file for that date is already this figure — approving it records the decision and leaves the salary record as it is."
      : approving.kind === "same-figure"
        ? `The salary on file for that date is already this figure, from ${formatDate(approving.from)}. Approving adds a record of its own from ${formatDate(detail.effectiveOn)} at the same figure, so pay does not change.`
        : approving.kind === "no-month"
          ? `Pay does not change: the later change on file from ${formatDate(approving.next)} starts in the same month, and a salary sheet takes the figure in force at the month's end, so this figure reaches no sheet. Approving still keeps it on the salary record from ${formatDate(detail.effectiveOn)}.`
          : approving.kind === "until-next"
            ? `There is a later change on file, from ${formatDate(approving.next)}. Approving sets this figure from ${formatDate(detail.effectiveOn)} until then; that change and any after it still apply, and months already paid do not change.`
            : null;
  if (note) figures.push({ label: "Note", value: note, block: true });
  return figures;
}

/** The pop-up: what HR asked, where it lands, and what finance did. */
function detailSections(
  row: HrRequestDto,
  detail: HrRequestDetailDto | null,
  money: (value: string | number) => string,
) {
  const asked = [
    { label: "Kind", value: KIND_LABELS[row.kind] },
    {
      label:
        row.kind === "pay_change" || row.kind === "one_off"
          ? "Person"
          : row.kind === "budget"
            ? "Category"
            : "Purpose",
      value: row.subject,
    },
    /* A pay change's date is "Effective from", under Finance below. */
    ...(row.kind === "pay_change"
      ? payFigures(row, detail, money)
      : [
          { label: "Amount", value: money(row.amount) },
          { label: "Takes effect", value: takesEffect(row) },
        ]),
    {
      label:
        row.kind === "pay_change"
          ? "Reason"
          : row.kind === "budget"
            ? "Period"
            : row.kind === "spend"
              ? "For"
              : "Note",
      value: row.detail,
    },
    { label: "HR's note", value: row.hrNote, block: true },
    { label: "Asked by", value: row.requestedByName },
    /* No "Approved in HR" (the owner, 6 Nov 2026: "aproved In HR ei field
       tao soriye diyo"). The table's Asked by still names who approved it
       in HR, small, under the asker. */
    {
      label: "Received",
      value: `${dhakaDay(row.receivedAt)}${row.sendCount > 1 ? ` · sent ${row.sendCount} times` : ""}`,
    },
  ];

  const lands: { label: string; value: ReactNode; block?: boolean }[] = [];
  if (detail && (row.kind === "pay_change" || row.kind === "one_off")) {
    /* A pay change's list stops at the next change on file; empty because
       that change starts in the same month is not "not built yet". */
    lands.push({
      label:
        row.kind === "pay_change"
          ? "Salary sheets it reaches"
          : "That month's sheet",
      value: detail.sheets.length
        ? detail.sheets
            .map(
              (sheet) => `${sheet.label} (${sheet.status.replace(/_/g, " ")})`,
            )
            .join(", ")
        : row.kind === "pay_change" &&
            detail.nextChangeOn !== null &&
            reachesNoMonth(detail)
          ? `None — the change on file from ${formatDate(detail.nextChangeOn)} decides that month`
          : "Not built yet",
      block: true,
    });
  }
  if (detail?.budget) {
    const b = detail.budget;
    lands.push({
      label: row.kind === "spend" ? "Against the budget" : "Spent against it",
      value:
        row.kind === "spend"
          ? `${b.categoryName}, ${formatDate(b.startsOn)} – ${formatDate(b.endsOn)}${b.amount ? ` · ${money(b.amount)}` : ""}`
          : `${money(b.spent ?? "0")} in ${b.spendCount} spend${b.spendCount === 1 ? "" : "s"}, ${money(b.paid ?? "0")} paid`,
      block: true,
    });
  }
  if (detail?.transactionRef) {
    lands.push({ label: "Paid as", value: detail.transactionRef });
  }

  const finance =
    row.state === "withdrawn"
      ? [
          { label: "State", value: <StateBadge row={row} /> },
          {
            label: "Withdrawn",
            value: row.decidedAt
              ? `${dhakaDay(row.decidedAt)} — HR took it back before anybody decided it`
              : "HR took it back before anybody decided it",
          },
          { label: "HR's reason", value: row.note, block: true },
        ]
      : [
          { label: "State", value: <StateBadge row={row} /> },
          {
            label: "Decided by",
            value: row.beforeApprovals
              ? "Nobody — applied before approvals existed (30 Sep 2026)"
              : row.decidedByName
                ? `${row.decidedByName}${row.decidedAt ? `, ${dhakaDay(row.decidedAt)}` : ""}`
                : null,
          },
          { label: "Finance's note", value: row.note, block: true },
          /* A pay change says when it takes effect, not when it was
             applied (the owner, 6 Nov 2026: "Money moved eta na theke
             effective from evabe thakle maybe beshi valo hobe"). */
          row.kind === "pay_change"
            ? { label: "Effective from", value: takesEffect(row) }
            : {
                label: "Money moved",
                value: row.appliedAt ? dhakaDay(row.appliedAt) : null,
              },
        ];

  const sections = [
    { title: "What HR asked", items: asked },
    ...(lands.length ? [{ title: "Where it lands", items: lands }] : []),
    { title: "Finance", items: finance },
  ];
  if (detail && detail.history.length) {
    sections.push({
      title: "History",
      items: detail.history.map((entry) => ({
        label: dhakaDay(entry.at),
        value: entry.summary,
        block: true,
      })),
    });
  }
  return sections;
}
