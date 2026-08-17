"use client";

import {
  BILLING_CYCLE_HABIT_LABELS,
  PSR_STATUS_LABELS,
  VENDOR_TYPE_LABELS,
  isFutureMonth,
  isRecurringType,
  wasPaidInPeriod,
  type Paginated,
  type SubscriptionLine,
  type SubscriptionSummary,
} from "@finance/shared";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Plus,
  Receipt,
  SquarePen,
  Store,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { useMoney } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { exportUrl } from "@/lib/ledger";
import {
  vendorsApi,
  type AccountDto,
  type CategoryNode,
  type VendorDto,
} from "@/lib/masters";
import { SubscriptionPaymentForm } from "./subscription-payment-form";
import { cn, formatDate } from "@/lib/utils";
import { VendorForm } from "./vendor-form";

export function VendorsScreen({
  initialPage,
  summary,
  accounts,
  categories,
}: {
  initialPage: Paginated<VendorDto>;
  summary: SubscriptionSummary;
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const router = useRouter();
  const canWrite = useCan("vendors.write");
  // Recording a payment writes to the ledger, so it is gated on that rather
  // than on the permission to edit the tool itself.
  const canRecordPayment = useCan("transactions.write");

  // Each read unconditionally: `exports.run` says this role may download
  // things, `vendors.read` says it may see this list.
  const canRunExports = useCan("exports.run");
  const canReadVendors = useCan("vendors.read");
  const canExport = canRunExports && canReadVendors;

  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  /** What the table is filtered by, as opposed to what is typed but unsubmitted. */
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VendorDto | null>(null);
  const [paying, setPaying] = useState<VendorDto | null>(null);

  /**
   * The month being looked at, and the figures for it.
   *
   * The server renders the current month. Stepping to another one refetches
   * only the summary — the tool list itself is not month-specific, so asking
   * for it again would be a request that returns the same rows.
   *
   * `shown` starts as the server's summary rather than null, so the figures are
   * on screen in the first paint instead of appearing a moment later.
   */
  const [shown, setShown] = useState(summary);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  const period = periodOf(shown);

  async function refresh(q = query) {
    setPage(
      await vendorsApi.list({
        pageSize: 50,
        includeInactive: true,
        q: q || undefined,
      }),
    );
    setApplied(q);
    router.refresh();
  }

  async function showMonth(year: number, month: number) {
    setLoadingMonth(true);
    setMonthError(null);
    try {
      setShown(await vendorsApi.subscriptions({ year, month }));
    } catch {
      setMonthError("Could not load that month. The figures below are still last month's.");
    } finally {
      setLoadingMonth(false);
    }
  }

  return (
    <>
      <PageHeader
        title="AI tools and subscriptions"
        description="What the company uses, what it usually costs, and what was actually paid for it."
        actions={
          <>
            <MonthStepper
              year={period.year}
              month={period.month}
              label={shown.period.label}
              busy={loadingMonth}
              onChange={(y, m) => void showMonth(y, m)}
            />
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  // The month on screen and the search on screen, so the file
                  // is the view rather than a different question's answer.
                  window.location.href = exportUrl("subscriptions", {
                    year: period.year,
                    month: period.month,
                    q: applied || undefined,
                    includeInactive: true,
                  });
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                Add
              </Button>
            ) : null}
          </>
        }
      />

      {monthError ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {monthError}
        </p>
      ) : null}

      <SpendStrip summary={shown} />

      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={(next) => void refresh(next)}
        placeholder="Search by name, contact, phone, or e-TIN"
        label="Search the tools and subscriptions"
        className="max-w-sm"
      />

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
                    Paid in {shortPeriod(shown.period.label)}
                  </Th>
                  <Th>Last paid</Th>
                  <Th className="text-right">{canWrite ? "" : null}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((vendor) => {
                  const line = lineFor(vendor.id, shown);
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
                        <span className="inline-flex items-center justify-end gap-1">
                          {canRecordPayment && isRecurringType(vendor.type) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPaying(vendor)}
                            >
                              <Receipt className="size-3.5" />
                              Record payment
                            </Button>
                          ) : null}
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
                        </span>
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
      <SubscriptionPaymentForm
        key={paying?.id}
        vendor={paying}
        accounts={accounts}
        categories={categories}
        onClose={() => setPaying(null)}
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
 * Which month the figures on screen belong to, taken from the period itself.
 *
 * Read off `period.start` rather than kept in its own state: two pieces of
 * state saying which month this is means two things that can disagree, and the
 * one the figures were actually measured over is the one that is true.
 */
function periodOf(summary: SubscriptionSummary) {
  return {
    year: Number(summary.period.start.slice(0, 4)),
    month: Number(summary.period.start.slice(5, 7)),
  };
}

/**
 * The company's records begin in May 2026. There is nothing before that to
 * look at, so there is nothing to step back to.
 */
const RECORDS_START = { year: 2026, month: 5 };

/**
 * One month at a time, forwards and backwards, within what exists.
 *
 * Its own stepper rather than the expenses one: that takes and returns a
 * from/to range, and this screen asks the API for a year and a month. Passing
 * a range here would mean converting back and forth at every step, and a
 * conversion in both directions is a place for the two to drift apart.
 */
function MonthStepper({
  year,
  month,
  label,
  busy,
  onChange,
}: {
  year: number;
  month: number;
  label: string;
  busy: boolean;
  onChange: (year: number, month: number) => void;
}) {
  function stepped(delta: number) {
    const raw = month - 1 + delta;
    return {
      year: year + Math.floor(raw / 12),
      month: (((raw % 12) + 12) % 12) + 1,
    };
  }

  const back = stepped(-1);
  const forward = stepped(1);

  // Greyed out rather than clickable-then-refused. A month that has not
  // happened has no figures, and a month before the records begin has none
  // either — in both cases the honest answer is to not offer the step.
  const atStart =
    back.year < RECORDS_START.year ||
    (back.year === RECORDS_START.year && back.month < RECORDS_START.month);
  const atNow = isFutureMonth(forward.year, forward.month);

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(back.year, back.month)}
        disabled={busy || atStart}
        aria-label="Previous month"
        className="cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="flex min-w-36 items-center justify-center gap-1.5 px-2 text-center text-sm font-medium">
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(forward.year, forward.month)}
        disabled={busy || atNow}
        aria-label="Next month"
        className="cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight className="size-4" />
      </button>
    </span>
  );
}

/**
 * The list price, in the currency it is charged in, with the other underneath.
 *
 * Dollars lead on this page because that is what these tools are charged in —
 * every AI subscription here is billed by an American company in USD, and the
 * question somebody brings to this screen is "is Claude still twenty dollars".
 * The taka line beneath is the translation, marked as approximate.
 *
 * Prominence follows the currency the thing is actually billed in rather than
 * always being the dollar: for the rare tool invoiced in taka, the recorded
 * taka figure stays the large one. Promoting a converted number above a
 * recorded one is the single thing this app is careful not to do.
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
      <Amount
        value={vendor.billingAmount}
        currency={vendor.billingCurrency}
        format="western"
        tone="neutral"
        className="text-sm font-medium"
      />
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
      {/*
        Taka leads here, unlike the usual-cost column beside it, and the
        difference is the point: this is what actually left a taka account —
        the bank debit, at the rate the bank used on the day. The dollar line
        under it is worked out at this month's rate, so the two will not always
        agree with the list price, and it is marked approximate for exactly
        that reason.
      */}
      <Amount
        value={line.paidThisPeriod}
        tone="neutral"
        className="text-sm font-medium"
      />
      {line.entriesThisPeriod > 1 ? (
        <span className="text-xs text-muted-foreground">
          {line.entriesThisPeriod} payments
        </span>
      ) : null}
    </span>
  );
}

/**
 * What was spent on tooling in the month being looked at.
 *
 * There were three cards here. "Bought this month" and "Not yet this month"
 * listed the same tool names that the table underneath already lists, in the
 * same order, one screen-inch higher — and the table says it better, because
 * it says what each one cost as well as which side of the line it fell on.
 * Two cards restating their neighbour is two cards' worth of height taken from
 * the thing people came to read.
 *
 * The figure is the ledger's. There is deliberately no "committed each month"
 * total: these are bought month by month — some months yes, some months no —
 * so a projected commitment would assert spending that may never happen.
 */
function SpendStrip({ summary }: { summary: SubscriptionSummary }) {
  const money = useMoney();

  // The headline counts everything settled on the card as tooling, named tool
  // or not — which is right, and also why it can exceed the tools listed
  // below. Saying so beats letting somebody add the column up and find a gap.
  const unattributed = Number(summary.unattributed) > 0;

  return (
    <Card className="flex max-w-sm items-center gap-3 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
        <Wallet className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Paid in {summary.period.label}
        </span>
        <Amount
          value={summary.paidThisPeriod}
          hideDecimals
          tone="neutral"
          className="block text-lg font-semibold"
        />
        {unattributed ? (
          <span className="block truncate text-xs text-muted-foreground">
            incl. {money(summary.unattributed, { hideDecimals: true })} not tied
            to a tool
          </span>
        ) : null}
      </span>
    </Card>
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
