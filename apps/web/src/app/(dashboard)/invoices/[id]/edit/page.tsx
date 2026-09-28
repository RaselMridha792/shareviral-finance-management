import { notFound } from "next/navigation";

import { InvoiceBuilder } from "@/components/invoice-builder/invoice-builder";
import { ApiError } from "@/lib/api-client";
import { invoicesApi } from "@/lib/invoices";

export const dynamic = "force-dynamic";

export const metadata = { title: "Invoice · SFM" };

/**
 * A saved invoice, open in the builder — All invoices' Edit, and where a new
 * invoice's address moves to once it is saved.
 */
export default async function EditInvoicePage({
  params,
}: PageProps<"/invoices/[id]/edit">) {
  const { id } = await params;
  const invoice = await invoicesApi.get(id).catch((error: unknown) => {
    // A deleted invoice, or an id that never was, is not a server fault.
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.status === 400)
    ) {
      return null;
    }
    throw error;
  });
  if (!invoice) notFound();

  return (
    <InvoiceBuilder
      key={`${invoice.id}:${invoice.updatedAt}`}
      mode={{ kind: "edit", invoice }}
    />
  );
}
