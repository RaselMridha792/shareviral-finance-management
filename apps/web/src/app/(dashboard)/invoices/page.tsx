import { InvoicesScreen } from "@/components/invoice-builder/invoices-screen";

export const dynamic = "force-dynamic";

export const metadata = { title: "All invoices · SFM" };

/** The saved invoices. The screen fetches its own rows, page by page. */
export default function InvoicesPage() {
  return <InvoicesScreen />;
}
