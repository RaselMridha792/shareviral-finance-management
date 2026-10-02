import { appPart } from "../../common/app-map";

/**
 * The income tax screen was retired on the owner's instruction ("income tax
 * part ta bad dibo, TDS e enough"). The module, its records and its
 * endpoints all still stand; nothing on the web shows them.
 */
export const INCOME_TAX_MAP = [
  appPart({
    key: "income_tax",
    name: "Company income tax",
    modules: ["income-tax"],
    purpose:
      "The company's own income tax: four advance instalments in a year, and the annual return. The records are kept, and there is no screen for them today.",
    keeps: [
      "An advance-tax instalment and what was paid against it.",
      "Tax a client deducted when paying us: an advance-tax credit, which belongs here and never on the receipt.",
    ],
    screens: [],
    forms: [],
    recordedBy: ["POST /income-tax/schedule", "POST /income-tax/:id/pay"],
    permission: "incometax.read",
    assistant: {
      drafts: [],
      reads: ["tax_status"],
      otherwise:
        "I cannot record company income tax, and no screen shows it today: the income tax screen was retired. I can tell you the schedule that is on file.",
    },
  }),
];
