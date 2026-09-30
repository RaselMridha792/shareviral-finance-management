"use client";

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { PiggyBankIcon } from "@phosphor-icons/react/dist/ssr/PiggyBank";
import { XCircleIcon } from "@phosphor-icons/react/dist/ssr/XCircle";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import {
  DecisionDrawer,
  PayDrawer,
} from "@/components/hr-budget/hr-budget-drawers";
import { useMoney } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  hrBudgetApi,
  type Decision,
  type HrBudgetPeriodDto,
  type HrBudgetSpendDto,
  type PeriodStatus,
  type SpendStatus,
} from "@/lib/hr-budget";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { serial } from "@/lib/pagination";
import { formatDate } from "@/lib/utils";

type Tab = "spends" | "budgets";

const SPEND_TABS: ReadonlyArray<{ id: SpendStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "received", label: "Waiting" },
  { id: "approved", label: "To pay" },
  { id: "paid", label: "Paid" },
  { id: "refused", label: "Refused" },
];
const PERIOD_TABS: ReadonlyArray<{ id: PeriodStatus | "all"; label: string }> =
  [
    { id: "all", label: "All" },
    { id: "received", label: "Waiting" },
    { id: "approved", label: "Approved" },
    { id: "refused", label: "Refused" },
  ];

/**
 * HR Budget — what the HR portal sends finance, and finance's answer.
 *
 * The owner, 30 Sep 2026: *"hr theke jokhon budget dibe kono kichur oita
 * finance a request jabe er jonne hr budet name finance a ekta new page o
 * banate hobe and properly sob information manage korte hobe"*.
 *
 * Two lists. **Spends** first, because they are what finance acts on:
 * approve or refuse each, and pay an approved one — which writes the expense
 * into the books. **Budgets** are HR's allocations — a category and a period
 * — approved or refused as allocations, each showing what has been spent
 * against it. A spend may name a budget that has not arrived yet; it says so.
 *
 * Every decision goes back to the HR portal when it asks, with the note.
 * Nothing here is typed by finance except the decision: the rows are HR's.
 */
export function HrBudgetScreen({
  initialTab = "spends",
  accounts,
  categories,
}: {
  /** Budgets when the bell sent somebody here about one (#122). */
  initialTab?: Tab;
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const canManage = useCan("hrbudget.manage");
  const canWriteLedger = useCan("transactions.write");
  /* Paying writes an expense, so it needs the ledger's permission too — the
     API asks for both. */
  const canPay = canManage && canWriteLedger;
  const money = useMoney();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [spendStatus, setSpendStatus] = useState<SpendStatus | "all">("all");
  const [periodStatus, setPeriodStatus] = useState<PeriodStatus | "all">("all");
  const [budgetFilter, setBudgetFilter] = useState<HrBudgetPeriodDto | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [spends, setSpends] = useState<HrBudgetSpendDto[]>([]);
  const [periods, setPeriods] = useState<HrBudgetPeriodDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showingSpend, setShowingSpend] = useState<HrBudgetSpendDto | null>(
    null,
  );
  const [showingPeriod, setShowingPeriod] = useState<HrBudgetPeriodDto | null>(
    null,
  );
  const [deciding, setDeciding] = useState<{
    kind: "period" | "spend";
    id: string;
    decision: Decision;
    summary: string;
  } | null>(null);
  const [paying, setPaying] = useState<HrBudgetSpendDto | null>(null);

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
      if (tab === "spends") {
        const result = await hrBudgetApi.spends({
          page,
          q: query || undefined,
          status: spendStatus === "all" ? undefined : spendStatus,
          budgetExternalId: budgetFilter?.externalId,
        });
        setSpends(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      } else {
        const result = await hrBudgetApi.periods({
          page,
          q: query || undefined,
          status: periodStatus === "all" ? undefined : periodStatus,
        });
        setPeriods(result.items);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      }
    } catch {
      setError("Could not load what HR has sent.");
    } finally {
      setLoading(false);
    }
  }, [tab, page, query, spendStatus, periodStatus, budgetFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const settingsMoney = (value: string) => money(value);
  const periodLine = (p: {
    categoryName: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
  }) =>
    p.categoryName
      ? `${p.categoryName}, ${formatDate(p.startsOn)} – ${formatDate(p.endsOn)}`
      : "Budget not here yet";

  const decide = (
    kind: "period" | "spend",
    id: string,
    decision: Decision,
    summary: string,
  ) => {
    setShowingSpend(null);
    setShowingPeriod(null);
    setDeciding({ kind, id, decision, summary });
  };

  const spendActions = (row: HrBudgetSpendDto, inPopup = false) => {
    if (!canManage) return null;
    const summary = `${row.purpose} · ${settingsMoney(row.amount)}`;
    const buttons = [];
    if (row.status === "received" || row.status === "refused") {
      buttons.push(
        inPopup ? (
          <Button
            key="approve"
            variant="primary"
            size="sm"
            onClick={() => decide("spend", row.id, "approved", summary)}
            data-hrb-approve
          >
            <CheckCircleIcon weight="duotone" size={16} />
            Approve
          </Button>
        ) : (
          <RowButton
            key="approve"
            label={`Approve ${row.purpose}`}
            title="Approve"
            icon={CheckCircleIcon}
            onClick={() => decide("spend", row.id, "approved", summary)}
          />
        ),
      );
    }
    if (row.status === "received" || row.status === "approved") {
      buttons.push(
        inPopup ? (
          <Button
            key="refuse"
            variant="secondary"
            size="sm"
            onClick={() => decide("spend", row.id, "refused", summary)}
            data-hrb-refuse
          >
            <XCircleIcon weight="duotone" size={16} />
            Refuse
          </Button>
        ) : (
          <RowButton
            key="refuse"
            label={`Refuse ${row.purpose}`}
            title="Refuse"
            icon={XCircleIcon}
            tone="danger"
            onClick={() => decide("spend", row.id, "refused", summary)}
          />
        ),
      );
    }
    if (row.status === "approved" && canPay) {
      buttons.push(
        inPopup ? (
          <Button
            key="pay"
            variant="primary"
            size="sm"
            onClick={() => {
              setShowingSpend(null);
              setPaying(row);
            }}
            data-hrb-pay
          >
            <HandCoinsIcon weight="duotone" size={16} />
            Pay
          </Button>
        ) : (
          <RowButton
            key="pay"
            label={`Pay ${row.purpose}`}
            title="Pay"
            icon={HandCoinsIcon}
            onClick={() => setPaying(row)}
          />
        ),
      );
    }
    if (inPopup && (row.status === "approved" || row.status === "refused")) {
      buttons.push(
        <Button
          key="back"
          variant="ghost"
          size="sm"
          onClick={() => decide("spend", row.id, "received", summary)}
        >
          <ArrowCounterClockwiseIcon weight="bold" size={15} />
          Put back
        </Button>,
      );
    }
    return buttons;
  };

  const periodActions = (row: HrBudgetPeriodDto, inPopup = false) => {
    if (!canManage) return null;
    const summary = `${periodLine(row)} · ${settingsMoney(row.amount)}`;
    const buttons = [];
    if (row.status !== "approved") {
      buttons.push(
        inPopup ? (
          <Button
            key="approve"
            variant="primary"
            size="sm"
            onClick={() => decide("period", row.id, "approved", summary)}
            data-hrb-approve
          >
            <CheckCircleIcon weight="duotone" size={16} />
            Approve
          </Button>
        ) : (
          <RowButton
            key="approve"
            label={`Approve ${row.categoryName}`}
            title="Approve"
            icon={CheckCircleIcon}
            onClick={() => decide("period", row.id, "approved", summary)}
          />
        ),
      );
    }
    if (row.status !== "refused") {
      buttons.push(
        inPopup ? (
          <Button
            key="refuse"
            variant="secondary"
            size="sm"
            onClick={() => decide("period", row.id, "refused", summary)}
            data-hrb-refuse
          >
            <XCircleIcon weight="duotone" size={16} />
            Refuse
          </Button>
        ) : (
          <RowButton
            key="refuse"
            label={`Refuse ${row.categoryName}`}
            title="Refuse"
            icon={XCircleIcon}
            tone="danger"
            onClick={() => decide("period", row.id, "refused", summary)}
          />
        ),
      );
    }
    if (inPopup && row.status !== "received") {
      buttons.push(
        <Button
          key="back"
          variant="ghost"
          size="sm"
          onClick={() => decide("period", row.id, "received", summary)}
        >
          <ArrowCounterClockwiseIcon weight="bold" size={15} />
          Put back
        </Button>,
      );
    }
    return buttons;
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
    if (next === "budgets") setBudgetFilter(null);
  };

  const columns = 10;

  return (
    <>
      <PageHeader
        title="HR Budget"
        icon={PiggyBankIcon}
        description="Budgets and spending HR sends from the HR portal — approve, refuse and pay them here."
      />

      <div className="sv-toolbar flex flex-wrap items-center gap-3">
        <Segmented
          options={[
            { id: "spends" as const, label: "Spends" },
            { id: "budgets" as const, label: "Budgets" },
          ]}
          value={tab}
          onChange={switchTab}
          label="What HR sent"
        />
        {tab === "spends" ? (
          <Segmented
            options={SPEND_TABS}
            value={spendStatus}
            onChange={(next) => {
              setSpendStatus(next);
              setPage(1);
            }}
            label="Spend status"
          />
        ) : (
          <Segmented
            options={PERIOD_TABS}
            value={periodStatus}
            onChange={(next) => {
              setPeriodStatus(next);
              setPage(1);
            }}
            label="Budget status"
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={
              tab === "spends"
                ? "Purpose, person, category…"
                : "Category, note…"
            }
          />
        </div>
      </div>

      {budgetFilter && tab === "spends" ? (
        <p className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-(--sv-muted)">Spends against</span>
          <span className="font-extrabold">{periodLine(budgetFilter)}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBudgetFilter(null);
              setPage(1);
            }}
          >
            Show every spend
          </Button>
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      {!loading &&
      !error &&
      (tab === "spends" ? spends.length : periods.length) === 0 ? (
        <Card>
          <EmptyState icon={PiggyBankIcon} title="Nothing here">
            {query || (tab === "spends" ? spendStatus : periodStatus) !== "all"
              ? "Try another status, or clear the search."
              : "When HR sends a budget or a spend from the HR portal, it arrives here."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableScroll>
            {tab === "spends" ? (
              <table className="table-data w-full min-w-[980px]">
                <thead>
                  <tr>
                    <SerialHead />
                    <Th>Spent on</Th>
                    <Th>Purpose</Th>
                    <Th>For</Th>
                    <Th>Budget</Th>
                    <Th align="right">Amount</Th>
                    <Th>HR</Th>
                    <Th>Receipt</Th>
                    <Th>Status</Th>
                    <Th width="w-28" align="right" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableMessageRow colSpan={columns}>
                      Loading…
                    </TableMessageRow>
                  ) : (
                    spends.map((row, index) => (
                      <tr
                        key={row.id}
                        className="row-finance"
                        {...rowOpener(() => setShowingSpend(row), row.id)}
                      >
                        <SerialCell n={serial(page, index)} />
                        <td className="font-extrabold whitespace-nowrap tabular-nums">
                          {formatDate(row.spentOn)}
                        </td>
                        <td
                          className="max-w-[200px] truncate"
                          title={row.purpose}
                        >
                          {row.purpose}
                        </td>
                        <td className="text-sm">
                          <Person row={row} />
                        </td>
                        <td className="max-w-[170px] truncate text-sm text-muted-foreground">
                          {row.budgetKnown ? (
                            row.categoryName
                          ) : (
                            <span className="text-(--sv-warn)">
                              Budget not here yet
                            </span>
                          )}
                        </td>
                        <td className="text-right font-extrabold whitespace-nowrap tabular-nums">
                          {settingsMoney(row.amount)}
                        </td>
                        <td className="text-sm whitespace-nowrap">
                          {/* Who approved it on HR's side, under the word,
                              so the column stays narrow. */}
                          {row.hrStatus === "approved" ? (
                            <span className="flex flex-col">
                              <span>Approved</span>
                              {row.hrApprovedByName ? (
                                <span className="max-w-[120px] truncate text-[11.5px] text-muted-foreground">
                                  {row.hrApprovedByName}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Proposed
                            </span>
                          )}
                        </td>
                        <td className="text-sm">
                          {row.hasReceipt ? (
                            "Yes"
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                        <td>
                          <SpendBadge status={row.status} />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            {spendActions(row)}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table className="table-data w-full min-w-[980px]">
                <thead>
                  <tr>
                    <SerialHead />
                    <Th>Category</Th>
                    <Th>Period</Th>
                    <Th align="right">Budget</Th>
                    <Th align="right">Spent</Th>
                    <Th align="right">Paid</Th>
                    <Th align="right">Left</Th>
                    <Th align="right">Spends</Th>
                    <Th>Status</Th>
                    <Th width="w-24" align="right" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableMessageRow colSpan={columns}>
                      Loading…
                    </TableMessageRow>
                  ) : (
                    periods.map((row, index) => {
                      const left =
                        Math.round(
                          (Number(row.amount) - Number(row.spentAmount)) * 100,
                        ) / 100;
                      return (
                        <tr
                          key={row.id}
                          className="row-finance"
                          {...rowOpener(() => setShowingPeriod(row), row.id)}
                        >
                          <SerialCell n={serial(page, index)} />
                          <td className="font-extrabold">{row.categoryName}</td>
                          <td className="text-sm whitespace-nowrap tabular-nums">
                            {formatDate(row.startsOn)} –{" "}
                            {formatDate(row.endsOn)}
                          </td>
                          <td className="text-right font-extrabold whitespace-nowrap tabular-nums">
                            {settingsMoney(row.amount)}
                          </td>
                          <td className="text-right whitespace-nowrap tabular-nums">
                            {settingsMoney(row.spentAmount)}
                          </td>
                          <td className="text-right whitespace-nowrap tabular-nums text-muted-foreground">
                            {settingsMoney(row.paidAmount)}
                          </td>
                          <td
                            className={
                              left < 0
                                ? "text-right font-extrabold whitespace-nowrap text-(--sv-neg) tabular-nums"
                                : "text-right whitespace-nowrap tabular-nums"
                            }
                          >
                            {settingsMoney(left.toFixed(2))}
                          </td>
                          <td className="text-right tabular-nums">
                            {row.spendCount}
                          </td>
                          <td>
                            <PeriodBadge status={row.status} />
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-1.5">
                              {periodActions(row)}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </TableScroll>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun={tab === "spends" ? "spend" : "budget"}
        onPage={setPage}
      />

      <RowDetails
        open={Boolean(showingSpend)}
        onClose={() => setShowingSpend(null)}
        title={showingSpend ? showingSpend.purpose : ""}
        description={
          showingSpend
            ? `${settingsMoney(showingSpend.amount)} · spent ${formatDate(showingSpend.spentOn)}`
            : undefined
        }
        footer={showingSpend ? spendActions(showingSpend, true) : undefined}
        sections={
          showingSpend
            ? [
                {
                  title: "What HR sent",
                  items: [
                    {
                      label: "Purpose",
                      value: showingSpend.purpose,
                      block: true,
                    },
                    {
                      label: "Amount",
                      value: settingsMoney(showingSpend.amount),
                    },
                    {
                      label: "Spent on",
                      value: formatDate(showingSpend.spentOn),
                    },
                    { label: "For", value: <Person row={showingSpend} /> },
                    {
                      label: "Budget",
                      value: showingSpend.budgetKnown
                        ? periodLine({
                            categoryName: showingSpend.categoryName,
                            startsOn: showingSpend.budgetStartsOn,
                            endsOn: showingSpend.budgetEndsOn,
                          })
                        : "Not here yet — it will link when HR sends it",
                    },
                    {
                      label: "HR's decision",
                      value:
                        showingSpend.hrStatus === "approved"
                          ? `Approved by ${showingSpend.hrApprovedByName ?? "N/A"}`
                          : "Proposed",
                    },
                    {
                      label: "Receipt",
                      value: showingSpend.hasReceipt ? "With HR" : "None",
                    },
                    {
                      label: "Recorded by",
                      value: showingSpend.recordedByName,
                    },
                    {
                      label: "Received",
                      value: `${formatDate(showingSpend.receivedAt.slice(0, 10))}${showingSpend.sendCount > 1 ? ` · sent ${showingSpend.sendCount} times` : ""}`,
                    },
                  ],
                },
                {
                  title: "Finance",
                  items: [
                    {
                      label: "Status",
                      value: <SpendBadge status={showingSpend.status} />,
                    },
                    { label: "Decided by", value: showingSpend.decidedByName },
                    {
                      label: "Note",
                      value: showingSpend.statusNote,
                      block: true,
                    },
                    {
                      label: "Paid",
                      value: showingSpend.paidOn
                        ? `${formatDate(showingSpend.paidOn)}${showingSpend.transactionRef ? ` · ${showingSpend.transactionRef}` : ""}`
                        : null,
                    },
                  ],
                },
              ]
            : []
        }
      />

      <RowDetails
        open={Boolean(showingPeriod)}
        onClose={() => setShowingPeriod(null)}
        title={showingPeriod ? showingPeriod.categoryName : ""}
        description={
          showingPeriod
            ? `${formatDate(showingPeriod.startsOn)} – ${formatDate(showingPeriod.endsOn)} · ${settingsMoney(showingPeriod.amount)}`
            : undefined
        }
        footer={
          showingPeriod ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setBudgetFilter(showingPeriod);
                  setShowingPeriod(null);
                  setTab("spends");
                  setSpendStatus("all");
                  setPage(1);
                }}
                data-hrb-see-spends
              >
                See its spends
              </Button>
              {periodActions(showingPeriod, true)}
            </>
          ) : undefined
        }
        sections={
          showingPeriod
            ? [
                {
                  title: "What HR sent",
                  items: [
                    { label: "Category", value: showingPeriod.categoryName },
                    {
                      label: "Period",
                      value: `${formatDate(showingPeriod.startsOn)} – ${formatDate(showingPeriod.endsOn)}`,
                    },
                    {
                      label: "Budget",
                      value: settingsMoney(showingPeriod.amount),
                    },
                    { label: "Note", value: showingPeriod.note, block: true },
                    {
                      label: "Recorded by",
                      value: showingPeriod.recordedByName,
                    },
                    {
                      label: "Received",
                      value: `${formatDate(showingPeriod.receivedAt.slice(0, 10))}${showingPeriod.sendCount > 1 ? ` · sent ${showingPeriod.sendCount} times` : ""}`,
                    },
                  ],
                },
                {
                  title: "Against it",
                  items: [
                    {
                      label: "Spends",
                      value: String(showingPeriod.spendCount),
                    },
                    {
                      label: "Spent (not refused)",
                      value: settingsMoney(showingPeriod.spentAmount),
                    },
                    {
                      label: "Paid",
                      value: settingsMoney(showingPeriod.paidAmount),
                    },
                  ],
                },
                {
                  title: "Finance",
                  items: [
                    {
                      label: "Status",
                      value: <PeriodBadge status={showingPeriod.status} />,
                    },
                    { label: "Decided by", value: showingPeriod.decidedByName },
                    {
                      label: "Note",
                      value: showingPeriod.statusNote,
                      block: true,
                    },
                  ],
                },
              ]
            : []
        }
      />

      {deciding ? (
        <DecisionDrawer
          key={`${deciding.id}:${deciding.decision}`}
          kind={deciding.kind}
          id={deciding.id}
          decision={deciding.decision}
          summary={deciding.summary}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            void load();
          }}
        />
      ) : null}

      {paying ? (
        <PayDrawer
          key={paying.id}
          spend={paying}
          accounts={accounts}
          categories={categories}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function Person({ row }: { row: HrBudgetSpendDto }) {
  if (row.teamMemberName) return <span>{row.teamMemberName}</span>;
  if (row.employeeName) {
    return (
      <span className="flex flex-col">
        <span>{row.employeeName}</span>
        <span className="text-[11.5px] text-muted-foreground">
          Not linked yet
        </span>
      </span>
    );
  }
  return <span className="text-muted-foreground">N/A</span>;
}

function SpendBadge({ status }: { status: SpendStatus }) {
  switch (status) {
    case "received":
      return <Badge tone="neutral">Waiting</Badge>;
    case "approved":
      return <Badge tone="primary">To pay</Badge>;
    case "paid":
      return <Badge tone="positive">Paid</Badge>;
    case "refused":
      return <Badge tone="negative">Refused</Badge>;
  }
}

function PeriodBadge({ status }: { status: PeriodStatus }) {
  switch (status) {
    case "received":
      return <Badge tone="neutral">Waiting</Badge>;
    case "approved":
      return <Badge tone="positive">Approved</Badge>;
    case "refused":
      return <Badge tone="negative">Refused</Badge>;
  }
}
