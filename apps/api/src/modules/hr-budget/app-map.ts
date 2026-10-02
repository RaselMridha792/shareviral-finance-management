import { appPart } from "../../common/app-map";

/**
 * The HR Budget page (#121) became part of HR Requests (#125): its old
 * address, `/hr-budget`, sends a reader there. The budgets and spends are
 * still this module's records.
 */
export const HR_BUDGET_MAP = [
  appPart({
    key: "hr_budget",
    name: "HR Budget",
    modules: ["hr-budget"],
    purpose:
      "HR's budgets, and the spending against them, as the HR portal sends them: a budget for a heading and a period, and each spend with its purpose and receipt. Finance approves or refuses each, and pays an approved spend. Paying a spend writes an ordinary expense in the ledger, and the spend points at it.",
    keeps: [
      "A budget HR asked for, and each spend against it. Paying one is done from the request, so the expense and the spend stay tied together.",
    ],
    screens: [
      {
        href: "/hr-requests",
        name: "HR Requests",
        does: "Budgets and spends are two of the four kinds listed there. An approved spend is paid from its row.",
      },
    ],
    recordedBy: [
      "POST /hr-budget/periods/:id/decision",
      "POST /hr-budget/spends/:id/decision",
      "POST /hr-budget/spends/:id/pay",
    ],
    permission: "hrbudget.read",
    assistant: {
      drafts: [],
      reads: ["hr_budget"],
      otherwise:
        "I cannot approve or pay a budget or a spend, and a spend HR sent is never recorded as a plain payment: it is paid from its row on HR Requests, which ties the expense to the spend.",
    },
  }),
];
