import { createVendorSchema } from "@finance/shared";

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
    // PATCH /vendors/:id is named by no form: nothing calls it. No screen
    // edits a vendor, and the Assistant only drafts new ones.
    forms: [
      {
        name: "The draft",
        on: "/assistant",
        opens: "the draft card for a vendor (no screen adds one)",
        saves: ["POST /vendors"],
        schema: createVendorSchema,
        fields: {
          type: "never ai_tool, subscription or hosting: those are plans",
          etin: "their e-TIN, 12 digits",
          bin: "their VAT BIN, 13 digits",
          psrStatus: "whether their tax return was submitted",
          psrAssessmentYear: "the year the PSR is for, like 2026-2027",
          nextRenewalOn: "kept for old rows; nothing reads it",
        },
        onSave:
          "Adds the vendor with its tax details. Refused if a vendor of that name exists. No screen lists vendors; the Assistant's vendor look-ups find it.",
        permission: "vendors.write",
        draft: "vendor",
      },
    ],
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
