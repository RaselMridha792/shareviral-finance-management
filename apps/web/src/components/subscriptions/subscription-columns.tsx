"use client";

import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatMoney,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type SubscriptionStatus,
} from "@finance/shared";
import { ImageIcon } from "lucide-react";
import { ReferenceCell } from "@/components/ledger/reference-kind";
import Link from "next/link";
import { Fragment } from "react";

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

/** The fourteen headings, in the order the owner reads them. */
export function SubscriptionHeadCells() {
  return (
    <>
      <Th>Start Date</Th>
      <Th>Tool Name</Th>
      <Th>Category</Th>
      <Th align="right">Equivalent (BDT)</Th>
      <Th align="right">Cost (USD)</Th>
      <Th align="right">USD Rate</Th>
      <Th>Payment Method</Th>
      <Th>Account/Card</Th>
      {/* The same pair every other money table carries, in the same place:
          ours, then theirs. */}
      <Th width="w-32">Invoice</Th>
      <Th width="w-32">Reference</Th>
      <Th>Notes</Th>
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
  numberFormat,
  handlers = {},
}: {
  row: SubscriptionDto;
  numberFormat: "bangladeshi" | "western";
  handlers?: SubscriptionRowHandlers;
}) {
  const money = (value: string, currency: string) =>
    formatMoney(value, { currency, format: numberFormat });

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
          {row.websiteUrl ? (
            <a
              href={row.websiteUrl}
              target="_blank"
              // Third-party addresses typed by whoever added the plan.
              // `noopener` is worth ruling out once rather than per link.
              rel="noreferrer noopener"
              title={`Open ${row.toolName}`}
              className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link transition"
            >
              {row.toolName}
            </a>
          ) : (
            <span
              className="font-medium"
              title="No website recorded — add one when you edit this plan."
            >
              {row.toolName}
            </span>
          )}
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
        {/* The plan rides under the name instead of taking a column. Two plans
            of one tool are otherwise the same row twice. */}
        <span className="block text-xs text-muted-foreground">
          {row.planName}
        </span>
      </td>

      <td className="text-sm text-muted-foreground">
        {SUBSCRIPTION_CATEGORY_LABELS[row.category]}
      </td>

      <td className="col-amount">
        {row.costBdt ? money(row.costBdt, "BDT") : "N/A"}
      </td>
      <td className="col-amount">{money(row.costUsd, "USD")}</td>
      <td className="col-amount text-sm text-muted-foreground">
        {row.usdRate ? Number(row.usdRate).toFixed(2) : "N/A"}
      </td>

      <td className="text-sm text-muted-foreground">
        {/* The method as typed — card, bank transfer… The account it names
            has its own column beside this one; they answer different
            questions and were once wrongly merged into one control. */}
        {PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod] ??
          row.paymentMethod}
      </td>

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
        The number, the click that opens the bill, or N/A.

        This printed a fixed em dash on every row — the cell had been emptied
        when the form stopped asking for an invoice NUMBER, on the reading that
        there was nothing to render. There was: the column exists, the service
        selects it, and rows carry values from before the change and from the
        importer. Meanwhile the screen was passing an `onInvoice` handler that
        nothing called, and the comment here claimed the eye beside Reference
        opened the invoice, which it does not — that handler is scoped to
        bank_statement, receipt and other.

        Plain text where no handler was passed: `member-tools` renders these
        same cells read-only, and a link that opens nothing is worse than none.
      */}
      <td className="num text-xs">
        {!row.invoiceNo ? (
          <span className="text-muted-foreground">N/A</span>
        ) : handlers.onInvoice ? (
          <button
            type="button"
            onClick={() => handlers.onInvoice?.(row)}
            title="Show the invoice"
            className="num cursor-pointer text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
          >
            {row.invoiceNo}
          </button>
        ) : (
          <span>{row.invoiceNo}</span>
        )}
      </td>

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
        {row.notes ? (
          <span title={row.notes} className="block max-w-[16rem] truncate">
            {row.notes}
          </span>
        ) : (
          "N/A"
        )}
      </td>

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
