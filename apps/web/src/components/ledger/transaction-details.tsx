"use client";

import {
  PAYMENT_METHOD_LABELS,
  TXN_ORIGIN_LABELS,
  type PaymentMethod,
  type TxnOrigin,
} from "@finance/shared";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/patterns";
import { RowDetails, type DetailSection } from "@/components/ui/row-details";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import { formatDate } from "@/lib/utils";

type ShownRow = TransactionDto & { runningBalance?: string };

/**
 * One ledger row, whole — what a click on a row opens.
 *
 * The tables lost their Description column on the owner's word (*"table theke
 * description ta soriye niba"*), so this is where the description is read
 * now, together with every field no column carries: the category, the party,
 * the payment method, the bank charge, the tax withheld, the sender of an
 * incoming wire, the notes, how the row was made and whether it was voided.
 *
 * A BANK CHARGE says which entry it was levied on, first thing — the owner,
 * 28 Sep 2026: *"bank charge er ekhane details a lekha nei eta kon transaction
 * er jonne charge ta add hoyeche etake clear kore mention korte hobe"*. Its
 * Entry No., what it was (Cash In, a transfer, a plan's renewal or upgrade, an
 * expense), its description, date, amount and account, and a button that
 * opens that entry's own record here, with a way back.
 *
 * The entry is FETCHED when a charge is opened (`GET /transactions/:id`)
 * rather than joined onto every list row: only charge rows need it, one popup
 * is open at a time, the lists (All transactions, a register, the statement,
 * the exports) keep the query they have, and the record that "Open" shows is
 * the whole entry anyway — so the one read serves both. It follows the link
 * the charge row has always carried, which is why a charge written before
 * this reads exactly as well as a new one.
 *
 * Used by every table whose rows are ledger entries — All transactions (and the
 * heading pages and a register, which draw the same table), Cash In, Other
 * expenses and the bank statement — so one entry reads the same wherever it is
 * clicked.
 */
export function TransactionDetails({
  row,
  onClose,
  onEdit,
  onOpenDocuments,
}: {
  /** Null closes it. */
  row: ShownRow | null;
  onClose: () => void;
  /** Offered only where the caller may edit this row. */
  onEdit?: (row: TransactionDto) => void;
  /** Opens the attached invoice, or the bank's record of the payment. */
  onOpenDocuments?: (row: TransactionDto, which: "invoice" | "payment") => void;
}) {
  /*
   * The entry a charge was levied on, while its record is the one shown.
   * Forgotten whenever the caller opens a different row — during the render
   * that notices, so the popup never paints one frame of the old entry.
   */
  const [entry, setEntry] = useState<TransactionDto | null>(null);
  const [openedFor, setOpenedFor] = useState(row?.id ?? null);
  if ((row?.id ?? null) !== openedFor) {
    setOpenedFor(row?.id ?? null);
    setEntry(null);
  }

  if (!row) return null;

  if (entry) {
    /*
     * The entry's own record, reached from its charge. No Edit here: the
     * screen this popup belongs to edits ITS rows with its own form, and the
     * entry may be a different kind of row altogether (a Cash In seen from
     * Other expenses). Back returns to the charge.
     */
    return (
      <RecordView
        row={entry}
        onClose={onClose}
        onOpenDocuments={onOpenDocuments}
        onBack={() => setEntry(null)}
      />
    );
  }

  return (
    <RecordView
      key={row.id}
      row={row}
      onClose={onClose}
      onEdit={onEdit}
      onOpenDocuments={onOpenDocuments}
      onOpenEntry={setEntry}
    />
  );
}

function RecordView({
  row,
  onClose,
  onEdit,
  onOpenDocuments,
  onOpenEntry,
  onBack,
}: {
  row: ShownRow;
  onClose: () => void;
  onEdit?: (row: TransactionDto) => void;
  onOpenDocuments?: (row: TransactionDto, which: "invoice" | "payment") => void;
  /** A charge's "Open" — shows the entry it was levied on. */
  onOpenEntry?: (entry: TransactionDto) => void;
  /** Set while showing an entry reached from its charge. */
  onBack?: () => void;
}) {
  const chargedOn = useChargedEntry(row.chargeForId);

  const voided = Boolean(row.voidedAt);
  const party = row.vendorName ?? row.counterparty;
  const recordedInUsd = row.originalCurrency === "USD" && row.originalAmount;
  const sender = [
    row.senderBankName,
    row.senderAccountName,
    row.senderAccountNumber,
    row.senderSwiftCode,
  ].some(Boolean);

  const paper = (
    value: string | null,
    count: number,
    which: "invoice" | "payment",
  ): ReactNode => {
    if (!value && count === 0) return null;
    return (
      <span className="inline-flex items-center gap-2">
        {value ?? `${count} attached`}
        {count > 0 && onOpenDocuments ? (
          <button
            type="button"
            onClick={() => onOpenDocuments(row, which)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 text-[13px] font-extrabold text-link transition hover:bg-(--sv-violet-tint)"
          >
            <EyeIcon weight="duotone" size={15} />
            View
          </button>
        ) : null}
      </span>
    );
  };

  const sections: DetailSection[] = [];

  /*
   * First, on a charge: what it was a charge FOR. First because it is the
   * question the owner could not answer from the old record, and the
   * description ("Bank charge — August Funding") only ever half-answered it.
   */
  if (row.chargeForId) {
    sections.push({
      title: "Bank charge for",
      items: chargedEntryItems(chargedOn, onOpenEntry),
    });
  }

  sections.push(
    {
      items: [
        { label: "Description", value: row.description, block: true },
        {
          label: "Type",
          value: (
            <StatusPill tone={row.direction === "in" ? "positive" : "negative"}>
              {row.direction === "in" ? "Cash In" : "Cash Out"}
            </StatusPill>
          ),
        },
        { label: "Category", value: row.categoryName },
        row.transferGroupId
          ? {
              label: "Transfer",
              value: "Between the company's own accounts",
            }
          : null,
        { label: "Party", value: party },
        voided
          ? {
              label: "Voided",
              value: row.voidReason
                ? `${formatDate(row.voidedAt as string)} — ${row.voidReason}`
                : formatDate(row.voidedAt as string),
            }
          : null,
      ].filter(Boolean) as DetailSection["items"],
    },
    {
      title: "Money",
      items: [
        {
          label: "Amount",
          value: (
            <Amount
              value={row.signedAmount}
              showSign
              currency={row.currency}
              showCounterpart={false}
            />
          ),
        },
        {
          /* A charge given in dollars is charged, not sent — same figure,
             the right verb. */
          label: recordedInUsd
            ? row.chargeForId
              ? "Charged in dollars"
              : "Dollars sent"
            : "In dollars",
          value: recordedInUsd ? (
            <Amount
              value={row.originalAmount as string}
              currency="USD"
              tone="neutral"
              showCounterpart={false}
            />
          ) : row.usdRate && Number(row.usdRate) > 0 ? (
            <Amount
              value={(Number(row.amount) / Number(row.usdRate)).toFixed(2)}
              currency="USD"
              tone="neutral"
              approximate
              showCounterpart={false}
            />
          ) : null,
        },
        {
          label: "USD rate",
          value:
            (row.fxRate ?? row.usdRate)
              ? Number(row.fxRate ?? row.usdRate).toFixed(2)
              : null,
        },
        Number(row.chargeAmount) > 0
          ? {
              label: "Bank charge",
              value: row.chargeUsd ? (
                /* Given in dollars: the dollars first, the taka it came to
                   beside them. */
                <span className="inline-flex items-baseline gap-2">
                  <Amount
                    value={row.chargeUsd}
                    currency="USD"
                    tone="neutral"
                    showCounterpart={false}
                  />
                  <span className="font-semibold text-(--sv-muted)">
                    <Amount
                      value={row.chargeAmount}
                      tone="neutral"
                      showCounterpart={false}
                    />
                  </span>
                </span>
              ) : (
                <Amount
                  value={row.chargeAmount}
                  tone="neutral"
                  showCounterpart={false}
                />
              ),
            }
          : null,
        row.billAmount
          ? {
              label: "Bill before tax",
              value: (
                <Amount
                  value={row.billAmount}
                  tone="neutral"
                  showCounterpart={false}
                />
              ),
            }
          : null,
        Number(row.withheldTaxAmount) > 0
          ? {
              label: "Tax withheld",
              value: (
                <Amount
                  value={row.withheldTaxAmount}
                  tone="neutral"
                  showCounterpart={false}
                />
              ),
            }
          : null,
        row.runningBalance
          ? {
              label: "Balance after",
              value: (
                <Amount
                  value={row.runningBalance}
                  tone="neutral"
                  showCounterpart={false}
                />
              ),
            }
          : null,
      ].filter(Boolean) as DetailSection["items"],
    },
    {
      title: "Where and how",
      items: [
        { label: "Date", value: formatDate(row.txnDate) },
        {
          label: "Account",
          value: row.accountName ? (
            <Link
              href={`/accounts/${row.accountId}`}
              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              {row.accountName}
            </Link>
          ) : null,
        },
        {
          label: "Paid by",
          value:
            PAYMENT_METHOD_LABELS[row.paymentMethod as PaymentMethod] ?? null,
        },
        { label: "Entry No.", value: row.refNo },
        {
          label: "Recorded",
          value: TXN_ORIGIN_LABELS[row.createdVia as TxnOrigin] ?? null,
        },
      ],
    },
    {
      title: "Paperwork",
      items: [
        {
          label: "Invoice",
          value: paper(row.invoiceNo, row.invoiceCount, "invoice"),
        },
        {
          label: "Reference",
          value: paper(row.reference, row.recordCount, "payment"),
        },
        row.receiptUrl
          ? {
              label: "Receipt",
              value: (
                <a
                  href={row.receiptUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                >
                  Open
                </a>
              ),
            }
          : null,
      ].filter(Boolean) as DetailSection["items"],
    },
  );

  if (sender) {
    sections.push({
      title: "Sent from",
      items: [
        { label: "Bank", value: row.senderBankName },
        { label: "Account name", value: row.senderAccountName },
        { label: "Account number", value: row.senderAccountNumber },
        { label: "SWIFT", value: row.senderSwiftCode },
      ],
    });
  }

  sections.push({
    items: [{ label: "Notes", value: row.notes, block: true }],
  });

  const footer = onBack ? (
    <div className="flex justify-start">
      <Button variant="secondary" onClick={onBack}>
        <ArrowLeftIcon weight="bold" size={16} className="text-(--sv-violet)" />
        Back to the bank charge
      </Button>
    </div>
  ) : onEdit && !voided ? (
    <div className="flex justify-end">
      <Button
        variant="secondary"
        onClick={() => {
          onClose();
          onEdit(row);
        }}
      >
        <PencilSimpleIcon
          weight="duotone"
          size={18}
          className="text-(--sv-violet)"
        />
        Edit
      </Button>
    </div>
  ) : undefined;

  return (
    <RowDetails
      open
      onClose={onClose}
      title={row.description}
      description={
        row.chargeForId && chargedOn.state === "ready"
          ? `${formatDate(row.txnDate)} · ${row.refNo} · charge on ${chargedOn.entry.refNo}`
          : `${formatDate(row.txnDate)} · ${row.refNo}`
      }
      sections={sections}
      footer={footer}
    />
  );
}

type ChargedEntry =
  | { state: "none" }
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; entry: TransactionDto };

/**
 * The entry a charge was levied on, read once when the charge is opened.
 *
 * `none` for every row that is not a charge, which is nearly all of them —
 * and those never make the request.
 */
function useChargedEntry(parentId: string | null): ChargedEntry {
  const [found, setFound] = useState<{
    id: string;
    result: ChargedEntry;
  } | null>(null);

  useEffect(() => {
    if (!parentId) return;
    let cancelled = false;
    ledgerApi
      .get(parentId)
      .then((entry) => {
        if (!cancelled)
          setFound({ id: parentId, result: { state: "ready", entry } });
      })
      .catch(() => {
        if (!cancelled) setFound({ id: parentId, result: { state: "failed" } });
      });
    return () => {
      cancelled = true;
    };
  }, [parentId]);

  if (!parentId) return { state: "none" };
  return found?.id === parentId ? found.result : { state: "loading" };
}

/**
 * What an entry was, in the words the screens use — read off the entry's own
 * fields, so it is right for a charge written on any day.
 */
export function entryKindOf(entry: TransactionDto): string {
  if (entry.transferGroupId) {
    const other = entry.transferOtherAccountName;
    return other
      ? `Money transfer ${entry.direction === "out" ? "to" : "from"} ${other}`
      : "Money transfer";
  }
  if (entry.subscriptionId) {
    return entry.upgradeToPlan
      ? `Subscription upgrade — to ${entry.upgradeToPlan}`
      : "Subscription renewal";
  }
  if (entry.createdVia === "payroll") return "Payroll payment";
  if (entry.createdVia === "tax_payment") return "Tax payment";
  if (entry.direction === "in") return "Cash In";
  return entry.categoryName ? `Expense — ${entry.categoryName}` : "Expense";
}

function chargedEntryItems(
  chargedOn: ChargedEntry,
  onOpenEntry: ((entry: TransactionDto) => void) | undefined,
): DetailSection["items"] {
  if (chargedOn.state === "loading" || chargedOn.state === "none") {
    return [{ label: "Entry No.", value: "Loading…" }];
  }
  if (chargedOn.state === "failed") {
    return [
      {
        label: "Entry No.",
        value:
          "The entry it belongs to could not be read. Close and open again.",
        block: true,
      },
    ];
  }

  const entry = chargedOn.entry;
  const recordedInUsd =
    entry.originalCurrency === "USD" && entry.originalAmount;
  return [
    {
      label: "Entry No.",
      value: (
        <span className="inline-flex items-center gap-2">
          <span data-charged-entry>{entry.refNo}</span>
          {onOpenEntry ? (
            <button
              type="button"
              data-open-charged-entry
              onClick={() => onOpenEntry(entry)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1 text-[13px] font-extrabold text-link transition hover:bg-(--sv-violet-tint)"
            >
              <EyeIcon weight="duotone" size={15} />
              Open
            </button>
          ) : null}
        </span>
      ),
    },
    { label: "What it was", value: entryKindOf(entry) },
    { label: "Its description", value: entry.description, block: true },
    { label: "Its date", value: formatDate(entry.txnDate) },
    {
      label: "Its amount",
      value: recordedInUsd ? (
        <span className="inline-flex items-baseline gap-2">
          <Amount
            value={entry.originalAmount as string}
            currency="USD"
            tone="neutral"
            showCounterpart={false}
          />
          <span className="font-semibold text-(--sv-muted)">
            <Amount
              value={entry.amount}
              tone="neutral"
              showCounterpart={false}
            />
          </span>
        </span>
      ) : (
        <Amount value={entry.amount} tone="neutral" showCounterpart={false} />
      ),
    },
    { label: "Its account", value: entry.accountName },
    entry.voidedAt
      ? { label: "State", value: "Voided — and this charge with it" }
      : null,
  ].filter(Boolean) as DetailSection["items"];
}
