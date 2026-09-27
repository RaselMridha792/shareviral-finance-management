"use client";

import {
  PAYMENT_METHOD_LABELS,
  TXN_ORIGIN_LABELS,
  type PaymentMethod,
  type TxnOrigin,
} from "@finance/shared";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import Link from "next/link";
import type { ReactNode } from "react";

import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/patterns";
import { RowDetails, type DetailSection } from "@/components/ui/row-details";
import type { TransactionDto } from "@/lib/ledger";
import { formatDate } from "@/lib/utils";

/**
 * One ledger row, whole — what a click on a row opens.
 *
 * The tables lost their Description column on the owner's word (*"table theke
 * description ta soriye niba"*), so this is where the description is read
 * now, together with every field no column carries: the category, the party,
 * the payment method, the bank charge, the tax withheld, the sender of an
 * incoming wire, the notes, how the row was made and whether it was voided.
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
  row: (TransactionDto & { runningBalance?: string }) | null;
  onClose: () => void;
  /** Offered only where the caller may edit this row. */
  onEdit?: (row: TransactionDto) => void;
  /** Opens the attached invoice, or the bank's record of the payment. */
  onOpenDocuments?: (row: TransactionDto, which: "invoice" | "payment") => void;
}) {
  if (!row) return null;

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

  const sections: DetailSection[] = [
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
          label: recordedInUsd ? "Dollars sent" : "In dollars",
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
              value: (
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
  ];

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

  return (
    <RowDetails
      open
      onClose={onClose}
      title={row.description}
      description={`${formatDate(row.txnDate)} · ${row.refNo}`}
      sections={sections}
      footer={
        onEdit && !voided ? (
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
        ) : undefined
      }
    />
  );
}
