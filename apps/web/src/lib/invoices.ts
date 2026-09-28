import type { Paginated } from "@finance/shared";

import type {
  InvoiceDraft,
  InvoiceStatus,
} from "@/components/invoice-builder/invoice-draft";
import { PAGE_SIZE } from "@/lib/pagination";

import { apiFetch } from "./api-client";

/**
 * Saved invoices (#118) — `apps/api/src/modules/invoices`.
 *
 * A new file rather than lines in `api-client.ts`: nothing else in the app
 * reads these, and a screen of its own should not widen a file twenty
 * screens import.
 */

/** One invoice as the list shows it. The document stays on the server. */
export type InvoiceRowDto = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  clientName: string | null;
  projectTitle: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  /** Worked out on the server from the items, in paisa. */
  totalAmount: string;
  usdRate: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
};

export type InvoiceDto = InvoiceRowDto & { document: InvoiceDraft };

export type ListInvoicesQuery = {
  page?: number;
  q?: string;
  status?: InvoiceStatus;
};

function query(input: ListInvoicesQuery & { pageSize: number }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const invoicesApi = {
  list: (input: ListInvoicesQuery = {}) =>
    apiFetch<Paginated<InvoiceRowDto>>(
      `/invoices?${query({ pageSize: PAGE_SIZE, ...input })}`,
      { cache: "no-store" },
    ),
  get: (id: string) =>
    apiFetch<InvoiceDto>(`/invoices/${id}`, { cache: "no-store" }),
  nextNumber: () =>
    apiFetch<{ number: string }>("/invoices/next-number", {
      cache: "no-store",
    }),
  create: (document: InvoiceDraft) =>
    apiFetch<InvoiceDto>("/invoices", {
      method: "POST",
      body: JSON.stringify({ document }),
    }),
  update: (id: string, document: InvoiceDraft) =>
    apiFetch<InvoiceDto>(`/invoices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ document }),
    }),
};
