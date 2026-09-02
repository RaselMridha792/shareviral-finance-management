"use client";

import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  type SubscriptionStatus,
  hasCharge,
  payableBdt,
} from "@finance/shared";
import { ImageIcon } from "lucide-react";
import { ReferenceCell } from "@/components/ledger/reference-kind";
import Link from "next/link";
import { Fragment } from "react";

import { Amount } from "@/components/money/amount";
import { Th } from "@/components/ui/table";
import type { SubscriptionDto } from "@/lib/subscriptions";
import { formatDate, cn } from "@/lib/utils";

/**
 * The fourteen columns of a subscription, written once.
 *
 * Two screens show this row — the subscriptions list, and "Paid tools" on a
 * team member's profile — and until now the profile showed four of the
 * fourteen because it had its own smaller query and its own smaller table. The
 * owner asked for the whole row in both places, which makes the interesting
 * question not "what does the profile show" but "what stops the two drifting
 * the first time a field is added".
 *
 * So the columns are a component rather than a convention: a head half and a
 * body half, both returning bare `<Th>`/`<td>` in a fragment, which a table
 * drops between its own serial column and its own actions. Each screen keeps
 * what is genuinely its own — the serial, the buttons at the end, the profile's
 * extra pair about this person's seat — and neither owns the fourteen.
 *
 * The handlers are optional on purpose. A cell whose handler is missing renders
 * the value as text instead of a button: the profile has no documents dialog,
 * and a link that opens nothing is worse than a plain number.
 */

export type SubscriptionRowHandlers = {
  /** Open the invoice for this plan. */
  onInvoice?: (row: SubscriptionDto) => void;
  /** Open the bank's record of the charge. */
  onReference?: (row: SubscriptionDto) => void;
  /** Show the plan as it was bought. */
  onScreenshot?: (row: SubscriptionDto) => void;
};

/**
 * The eleven headings the owner reads a register by.
 *
 * There were seventeen. His list of what matters — *"sl, date, account,
 * invoice, transaction, login account, username, depertment, billing cycle,
 * next renewal date, status aigula important and baki gula single page a
 * jabe"* — leaves out six: Category, Equivalent (BDT), Cost (USD), USD Rate,
 * Payment Method and Notes. All six are on the plan's own page, one click from
 * the tool's name, so nothing is lost — the register stops being a wall.
 *
 * The eleven are already in his order once the six are deleted, so this is a
 * deletion and not a reordering.
 */
export function SubscriptionHeadCells() {
  return (
    <>
      <Th>Start Date</Th>
      <Th>Tool Name</Th>
      {/* The owner: "ekhane tool name and plan akoi table er row te cole geche
          eta alada row hobe". They were stacked in one cell — the plan in small
          type under the name — which reads as a caption rather than as a
          column, cannot be scanned down, and has no heading naming it. Two
          facts, two columns. */}
      <Th>Plan</Th>
      {/*
        What the plan actually costs per cycle — its taka price plus whatever
        the card adds on top.

        ONE column, not the three that were taken off this table. The owner had
        Cost (USD), Equivalent (BDT) and USD Rate removed — *"baki gula single
        page a jabe"* — and all three are still on the plan's own page. This is
        not those three coming back: it is the single figure that leaves the
        account, which is what he asked to see beside the charge. The split
        sits under it in small type, and only on the rows that have one.

        Placed after the subject and before the bank details, which is where
        the standard column order puts an amount.
      */}
      <Th align="right">Total / cycle</Th>
      <Th>Account/Card</Th>
      {/* The same pair every other money table carries, in the same place:
          ours, then theirs. */}
      <Th width="w-32">Invoice</Th>
      <Th width="w-32">Reference</Th>
      <Th>Login accounts</Th>
      <Th>User Name</Th>
      <Th>User Department</Th>
      <Th>Billing Cycle</Th>
      <Th>Next Renewal Date</Th>
      <Th>Status</Th>
    </>
  );
}

export function SubscriptionBodyCells({
  row,
  handlers = {},
}: {
  row: SubscriptionDto;
  handlers?: SubscriptionRowHandlers;
}) {
  /* No `numberFormat`. The three money columns moved to the plan's own page
     with the trim, so nothing here formats a figure — and a prop every caller
     had to pass for nothing is a prop that goes. */
  return (
    <>
      <td className="text-sm">
        <span className="num">{formatDate(row.startDate)}</span>
      </td>

      <td>
        {/*
          The name goes to the tool's own page; the small picture beside it
          opens the plan as it was bought.

          The name used to open the screenshot, which was the earlier request —
          but a name cannot do both, and of the two the address is what
          somebody clicking a tool's name expects. The screenshot keeps its own
          affordance rather than losing one.
        */}
        <span className="flex items-center gap-1.5">
          {/*
            The NAME goes to the plan's own page now, not to the vendor's site.

            It used to open the tool's website, which was right while the table
            held everything a plan knows: there was nowhere else to go. Six of
            those columns have moved to `/subscriptions/[id]`, so the name has
            somewhere of ours to lead — and a table whose only link leaves the
            app is a table you cannot drill into.

            The vendor's site keeps its own way through: the plan page has an
            "Open <tool>" link at the top, next to the name.
          */}
          <Link
            href={`/subscriptions/${row.id}`}
            title={`Everything about ${row.toolName}`}
            className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
          >
            {row.toolName}
          </Link>
          {row.screenshotFileId && handlers.onScreenshot ? (
            <button
              type="button"
              onClick={() => handlers.onScreenshot?.(row)}
              title="Show the plan as it was bought"
              aria-label={`Show the plan screenshot for ${row.toolName}`}
              className="cursor-pointer rounded p-0.5 text-muted-foreground transition hover:text-primary"
            >
              <ImageIcon className="size-3 shrink-0" />
            </button>
          ) : null}
        </span>
      </td>

      {/* The plan, its own column now — two plans of one tool are otherwise
          the same row twice, and stacked under the name it read as a caption
          with no heading to scan against. */}
      <td className="text-sm text-muted-foreground">{row.planName}</td>

      {/*
        The payable figure, with its parts underneath.

        `payableBdt` rather than arithmetic here: the ledger takes the same
        function's answer when a payment is recorded, so what this cell says
        and what the account is debited cannot drift apart.

        A plan with no charge prints the figure alone. A "+ 0.00" on every row
        of an all-taka register is a mark on everything, which marks nothing —
        the same reason the salary sheet's warning triangle came off.
      */}
      <td>
        <div className="flex flex-col items-end">
          {payableBdt(row) ? (
            <Amount
              value={payableBdt(row) ?? "0"}
              tone="neutral"
              showCounterpart={false}
              className="block"
            />
          ) : (
            <span className="text-sm text-muted-foreground">N/A</span>
          )}
          {hasCharge(row) ? (
            <span
              className="num text-[11px] leading-tight text-muted-foreground"
              title={`$${row.costUsd} plus a $${row.chargeUsd} charge, at ${row.usdRate ?? "no rate"}`}
            >
              ${row.costUsd} + ${row.chargeUsd}
            </span>
          ) : null}
        </div>
      </td>

      {/* Category, USD, the rate, and Payment Method are on the plan's own
          page. Five columns of a seventeen-column table that the owner does
          not read here. */}

      <td className="text-sm text-muted-foreground">
        {/* Opens the account itself — the card, its balance and what else it
            pays for — rather than leaving the reader to go and find it on the
            accounts list. */}
        {row.accountName ? (
          row.accountId ? (
            <Link
              href={`/accounts/${row.accountId}`}
              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
            >
              {row.accountName}
            </Link>
          ) : (
            row.accountName
          )
        ) : (
          "N/A"
        )}
      </td>

      {/*
        An eye, like its neighbour.

        The owner: "ekhane table gulate ekta jaygay inv lekha arekta jaygay eye
        button. duitai eye button rakho eta better hobe." He is right: the two
        cells do the same thing — open what is attached — and wearing two
        different shapes made them look like two different acts. The invoice
        cell showed a truncated number that was really a button; the reference
        cell showed an eye. The eye is the one that says what the click does.

        The invoice NUMBER is not lost. It is on the plan's own page, which the
        tool name opens, and it is still what the search box matches on.

        The count behind it is the plan's WHOLE paper count rather than its
        invoices alone,
        so this eye appears whenever the plan carries any paper — exactly as the
        reference cell beside it does, from the same number. Two cells sharing
        one imprecision is better than two cells disagreeing about when to offer
        a control.
      */}
      <ReferenceCell
        value={null}
        documentCount={row.documentCount}
        onOpen={() => handlers.onInvoice?.(row)}
      />

      {/*
        Number, eye, or dash — see ledger/reference-kind.tsx. Only where a
        handler was passed: member-tools renders these same cells read-only,
        and an eye that opens nothing is worse than a dash.
      */}
      {handlers.onReference ? (
        <ReferenceCell
          value={row.reference}
          documentCount={row.documentCount}
          onOpen={() => handlers.onReference?.(row)}
        />
      ) : (
        <td className="num text-xs">
          {row.reference ?? <span className="text-muted-foreground">N/A</span>}
        </td>
      )}



      <td className="text-sm text-muted-foreground">
        {row.loginEmail ?? "N/A"}
      </td>

      <td className="text-sm">
        <SeatNames row={row} />
      </td>

      <td className="text-sm text-muted-foreground">
        {row.boughtFor ?? "N/A"}
      </td>

      <td className="text-sm text-muted-foreground">
        {BILLING_CYCLE_LABELS[row.billingCycle]}
      </td>

      <td className="text-sm">
        {row.nextRenewalOn ? (
          <span className="num">{formatDate(row.nextRenewalOn)}</span>
        ) : (
          /* The note cannot be typed any more, but rows written while it could
             still carry one, and it is the only thing this column has to say
             about them. */
          <span className="text-muted-foreground">
            {row.renewalNote ?? "N/A"}
          </span>
        )}
      </td>

      <td>
        <SubscriptionStatusPill status={row.status} />
      </td>
    </>
  );
}

/**
 * Who is on the plan, each name its own link.
 *
 * It was one joined string, which is what a column headed "User Name" looks
 * like until somebody wants to go and see one of them. The names are the same
 * names the team screen lists, so each is a link to that person; the separator
 * stays a comma so the cell still reads as a list rather than a stack.
 *
 * Clamped with the whole list on the title, because a plan with thirteen seats
 * would otherwise set the height of every row above and below it.
 */
function SeatNames({ row }: { row: SubscriptionDto }) {
  if (row.users.length === 0) {
    return <span className="text-muted-foreground">N/A</span>;
  }

  const all = row.users.map((seat) => seat.fullName).join(", ");

  return (
    <span title={all} className="block max-w-[14rem] truncate">
      {row.users.map((seat, index) => (
        <Fragment key={seat.teamMemberId}>
          {index > 0 ? ", " : null}
          <Link
            href={`/team/${seat.teamMemberId}`}
            className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
          >
            {seat.fullName}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

export function SubscriptionStatusPill({
  status,
}: {
  status: SubscriptionStatus;
}) {
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
