"use client";

import { formatMoney } from "@finance/shared";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { freshDraft } from "@/components/invoice-builder/invoice-draft";
import { InvoiceModal } from "@/components/invoice-builder/invoice-modal";
import {
  InvoiceSheet,
  SHEET_CSS,
  printSheet,
} from "@/components/invoice-builder/invoice-sheet";
import { SheetFit } from "@/components/invoice-builder/sheet-fit";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  invoicesApi,
  type InvoiceDto,
  type InvoiceRowDto,
} from "@/lib/invoices";

/**
 * A saved invoice, in a popup — what a click on its row opens.
 *
 * The owner: *"table a jekono jaygay click korlei popup a invoice ta view
 * kora jabe"*. The invoice itself, as it prints, rather than a list of its
 * fields: an invoice is read as a page. The footer holds what can be done
 * with it — download it, open it in the builder, or send it to the trash.
 *
 * The row carries the list's columns only; the document is fetched when the
 * popup opens, so the list stays light however many invoices there are.
 */
export function InvoiceViewer({
  row,
  onClose,
  onDelete,
}: {
  row: InvoiceRowDto;
  onClose: () => void;
  /** Absent for somebody who cannot delete. */
  onDelete?: (row: InvoiceRowDto) => void;
}) {
  const settings = useSettings();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    invoicesApi
      .get(row.id)
      .then((found) => live && setInvoice(found))
      .catch((caught: unknown) => {
        if (!live) return;
        setError(
          caught instanceof ApiError
            ? caught.message
            : "The invoice could not be loaded.",
        );
      });
    return () => {
      live = false;
    };
  }, [row.id]);

  const taka = formatMoney(row.totalAmount, { format: settings.numberFormat });

  return (
    <InvoiceModal
      open
      onClose={onClose}
      title={`Invoice ${row.invoiceNumber}`}
      description={`${row.clientName ?? "No client named"} · ${taka}`}
      footer={
        <>
          {onDelete ? (
            <Button
              variant="secondary"
              size="sm"
              className="mr-auto text-(--sv-neg)"
              onClick={() => onDelete(row)}
              data-invoice-view-delete
            >
              <TrashIcon weight="duotone" size={15} />
              Move to trash
            </Button>
          ) : null}
          <Link
            href={`/invoices/${row.id}/edit`}
            className="sv-button-quiet inline-flex h-[38px] items-center gap-[7px] rounded-lg bg-surface px-[13px] text-[13px] font-extrabold transition-colors"
            data-invoice-view-edit
          >
            <PencilSimpleIcon weight="duotone" size={15} />
            Edit
          </Link>
          <Button
            variant="primary"
            size="sm"
            disabled={!invoice}
            onClick={() => {
              if (sheetRef.current) {
                void printSheet(sheetRef.current, row.invoiceNumber);
              }
            }}
            data-invoice-view-download
          >
            <DownloadSimpleIcon weight="bold" size={15} />
            Download PDF
          </Button>
        </>
      }
    >
      <style>{SHEET_CSS}</style>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
        >
          {error}
        </p>
      ) : invoice ? (
        <div className="rounded-[11px] bg-(--sv-subtle) p-3">
          <SheetFit>
            <InvoiceSheet
              /* Filled over a fresh one, so a field the builder gained after
                 this was saved still draws. */
              draft={{ ...freshDraft(null), ...invoice.document }}
              format={settings.numberFormat}
              sheetRef={sheetRef}
            />
          </SheetFit>
        </div>
      ) : (
        <div className="h-[520px] animate-pulse rounded-[11px] bg-(--sv-subtle)" />
      )}
    </InvoiceModal>
  );
}
