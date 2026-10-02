import { appPart } from "../../common/app-map";

/**
 * Vendors has endpoints and a table and, today, no screen: the
 * supplier-and-spend screen was taken off the rail, and a tool or a
 * subscription is a plan under AI tools and subscriptions, not a vendor. A
 * payment records who it went to in its own description.
 */
export const VENDORS_MAP = [
  appPart({
    key: "vendors",
    name: "Vendors",
    modules: ["vendors"],
    purpose:
      "A supplier's own details: name, kind, e-TIN, BIN and whether their tax return was submitted (PSR). Kept for the tax withheld from a supplier's bill. No screen lists vendors today, and a payment does not name one: who was paid is written in the payment's description.",
    keeps: [
      "A supplier's tax details: e-TIN, BIN, PSR status.",
      "Not a tool or a subscription: that is a plan under AI tools and subscriptions.",
    ],
    screens: [],
    recordedBy: ["POST /vendors"],
    permission: "vendors.read",
    assistant: {
      drafts: ["vendor"],
      reads: ["list_vendors", "find_party"],
      otherwise:
        "No screen lists vendors today, so there is nothing to open. A payment says who it went to in its description.",
    },
  }),
];
