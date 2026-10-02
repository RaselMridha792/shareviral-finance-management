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
