import { saveStatementSchema } from "@finance/shared";

import { appPart } from "../../common/app-map";

export const REPORTS_MAP = [
  appPart({
    key: "reports",
    name: "Reports",
    modules: ["reports"],
    purpose:
      "The finance statement for a period — a month, a quarter, a half or a year: the position for that period, with its notes and who signed it off. Its figures are read from the ledger; only the notes, the status and the signatories are typed.",
    keeps: [
      "A statement's notes, status and signatories. Never a figure: a wrong figure on a report is corrected on the entry it came from.",
    ],
    screens: [
      {
        href: "/reports",
        name: "Reports",
        does: "The finance statement for the period chosen, with its notes and sign-off.",
      },
    ],
    forms: [
      {
        name: "Notes to the accounts",
        on: "/reports",
        opens:
          "The card at the foot of the statement, for the period picked at the top; Save at its bottom",
        saves: ["PATCH /reports/statement"],
        schema: saveStatementSchema,
        fields: {
          periodStart: "first day of the period picked at the top",
          cycle: "which statement this is within the financial year, 1 to 99",
          status: "reconciled means every figure was checked against the bank",
          signatories:
            "up to 4, each a name, a title and an uploaded signature",
          audited: "signed off by whoever audits; not on the screen",
          committedForwardTxnIds:
            "this period's receipts spent next period; not on the screen",
        },
        onSave:
          "Keeps the period's notes, cycle, status and signatories, and drops any uploaded signature no signatory names. No figure changes. A signatory without a name and a title is left out. Shows on the statement and its PDF.",
        permission: "transactions.write",
      },
      {
        name: "Upload signature",
        on: "/reports",
        opens:
          "Upload signature (Replace once there is one), on a signatory's card under Signed by",
        saves: ["POST /reports/statement/signature"],
        fields: {
          file: "PNG or JPEG under 300 KB, at least 300px wide, wider than tall",
        },
        onSave:
          "Stores the scan as a file of this period's statement, creating the statement's row if it has none, and shows it on that card. It stays on the signatory only once Notes to the accounts is saved.",
        permission: "transactions.write",
      },
    ],
    recordedBy: ["PATCH /reports/statement"],
    permission: "reports.view",
    assistant: {
      drafts: [],
      reads: ["period_summary"],
      otherwise:
        "I cannot produce or change the finance statement. It is on Reports, where the period is chosen. I can give you a period's money in, money out and biggest headings.",
    },
  }),
];
