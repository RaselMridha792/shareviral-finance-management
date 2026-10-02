import { appPart } from "../../common/app-map";

/**
 * Expenses has no endpoints of its own: its screens read the ledger
 * (`GET /expenses/overview` and `/expenses/summary`, on the transactions
 * controller), and an expense is recorded as an ordinary money-out entry.
 */
export const EXPENSES_MAP = [
  appPart({
    key: "expenses",
    name: "Expenses",
    modules: ["expenses"],
    purpose:
      "Money going out, read by what it was for. Expense overview cuts a month into four slices that add up: Salary, AI tools and subscriptions, Office rent and Operational expenses. Operational expenses shows each expense heading and, under it, its sub-categories and entries.",
    keeps: [
      "Nothing of its own. An expense is a money-out entry in the ledger, filed under a sub-category; these screens are views of it.",
    ],
    screens: [
      {
        href: "/expenses/overview",
        name: "Expense overview",
        does: "The month's spending as slices, each against the month before.",
      },
      {
        href: "/expenses",
        name: "Operational expenses",
        does: "Each expense heading with what was spent under it in the month.",
      },
      {
        href: "/expenses/[category]",
        name: "A heading's own page",
        does: "One heading: its sub-categories and every entry under it. Add expense records a payment under this heading.",
      },
      {
        href: "/expenses/other",
        name: "Other expenses",
        does: "Money out that is not tooling. Add expense records a payment.",
      },
    ],
    recordedBy: ["POST /transactions"],
    permission: "transactions.read",
    assistant: {
      drafts: ["transaction_out"],
      reads: ["find_transactions", "period_summary"],
      otherwise:
        "I cannot add or rename an expense heading or a sub-category. That is done under Settings, Categories.",
    },
  }),
];
