import { InvoiceBuilder } from "@/components/invoice-builder/invoice-builder";
import { invoicesApi } from "@/lib/invoices";

export const dynamic = "force-dynamic";

export const metadata = { title: "New invoice · SFM" };

/**
 * Add New: the builder, on a fresh invoice offered the number after the last
 * one saved.
 *
 * Keyed by that number, so coming back here after saving one starts a new
 * builder rather than keeping the one just saved — Next keeps a client
 * component's state across a visit to the same page, and the next number is
 * what changes when an invoice is saved.
 */
export default async function NewInvoicePage() {
  const next = await invoicesApi
    .nextNumber()
    .then((answer) => answer.number || null)
    // Never fatal: the builder offers INV-001 and the server refuses a
    // number that is taken, in words.
    .catch(() => null);

  return (
    <InvoiceBuilder
      key={next ?? "new"}
      mode={{ kind: "new", nextNumber: next }}
    />
  );
}
