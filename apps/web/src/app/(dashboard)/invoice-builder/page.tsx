import { permanentRedirect } from "next/navigation";

/**
 * The Invoice Builder moved under Invoices when invoices started being saved
 * (#118): All invoices at `/invoices`, the builder at `/invoices/new`.
 *
 * Left behind for the day it was live at this address — a bookmark, a link
 * in a note. The permission check is the new page's (`invoices/layout.tsx`).
 */
export default function InvoiceBuilderRedirect() {
  permanentRedirect("/invoices/new");
}
