import { appPart } from "../../common/app-map";

export const INVOICES_MAP = [
  appPart({
    key: "invoices",
    name: "Invoice Builder",
    modules: ["invoices"],
    purpose:
      "The invoices the company sends its clients, built on a sheet and kept. An invoice is a document, not money that moved: saving one writes nothing to the ledger. The money it asks for is recorded as money coming in when it arrives.",
    keeps: [
      "An invoice: its number, the client, its lines and its total.",
      "Not the payment of it: that is money coming in, recorded when it lands.",
    ],
    screens: [
      {
        href: "/invoices",
        name: "All Invoices",
        does: "Every saved invoice. A row is viewed, edited or deleted from here.",
      },
      {
        href: "/invoices/new",
        name: "Add New",
        does: "The builder, on a new invoice with the next number.",
      },
      {
        href: "/invoices/[id]/edit",
        name: "A saved invoice, in the builder",
        does: "One invoice, open for changes.",
      },
    ],
    recordedBy: ["POST /invoices", "PATCH /invoices/:id"],
    permission: "transactions.write",
    assistant: {
      drafts: [],
      reads: ["find_invoices"],
      otherwise:
        "I cannot build, change or delete an invoice. That is done under Invoice Builder: Add New for a new one, All Invoices for one already saved.",
    },
  }),
];
