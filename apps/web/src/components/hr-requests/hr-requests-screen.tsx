"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { PauseCircleIcon } from "@phosphor-icons/react/dist/ssr/PauseCircle";
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
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
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

  const columns = 10;
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
          <TableScroll>
            <table className="table-data w-full min-w-[1040px]">
              <thead>
                <tr>
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
    </>
  );
}

/**
 * A pay change's figures beside the one asked for.
 *
 * Approved and applied, it is the figure in force the day before — and the
 * history says what an approval replaced. Otherwise what the CFO needs is
 * what is on file FOR that date and what is paid today: the HR portal
 * re-sends an old revision whenever the two apps disagree (its Brief 7 §6),
 * and without these a correction reads as a raise. Only while it waits is
 * what approving would do said in words (`payChangeCase`): the same figure
 * already on file from that date (the salary record is left as it is), the
 * same figure from earlier (a record of its own, pay unchanged), a later
 * change in the same month (the figure reaches no sheet), and a date before
 * a later change, where the approved figure stops at that change.
 */
function payFigures(
  row: HrRequestDto,
  detail: HrRequestDetailDto | null,
  money: (value: string | number) => string,
): { label: string; value: ReactNode; block?: boolean }[] {
  if (!detail) return [{ label: "Salary on file", value: "…" }];
  if (row.state === "approved") {
    return [
      {
        label: "In force the day before",
        value: detail.previousAmount
          ? money(detail.previousAmount)
          : "None on record",
      },
    ];
  }
  const figures: { label: string; value: ReactNode; block?: boolean }[] = [
    {
      label: "On file for that date",
      value: detail.onFileAmount
        ? money(detail.onFileAmount)
        : "None on record",
    },
  ];
  /* Said whenever it differs — and when nothing is in force today, said so,
     rather than left out and read as "the same as on file". */
  if (detail.onFileAmount !== null && detail.currentAmount === null) {
    figures.push({ label: "Paid today", value: "None on record" });
  } else if (
    detail.currentAmount !== null &&
    Number(detail.currentAmount) !== Number(detail.onFileAmount)
  ) {
    figures.push({ label: "Paid today", value: money(detail.currentAmount) });
  }
  if (row.state !== "pending" && row.state !== "held") return figures;

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
    {
      label: row.kind === "pay_change" ? "New salary" : "Amount",
      value: money(row.amount),
    },
    ...(row.kind === "pay_change" ? payFigures(row, detail, money) : []),
    { label: "Takes effect", value: takesEffect(row) },
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
    {
      label: "Approved in HR",
      value: row.hrApprovedByName
        ? `${row.hrApprovedByName}${row.hrApprovedAt ? `, ${dhakaDay(row.hrApprovedAt)}` : ""}`
        : null,
    },
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
          {
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
