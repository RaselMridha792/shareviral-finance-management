import { createCategorySchema, createTransactionSchema } from "@finance/shared";

import { appPart } from "../../common/app-map";

/**
 * Expenses has no endpoints of its own: its screens read the ledger
 * (`GET /expenses/overview` and `/expenses/summary`, on the transactions
 * controller), and an expense is recorded as an ordinary money-out entry.
 *
 * Its forms are the ledger's own drawer, opened from an expense screen, and
 * the category drawer. An entry's row actions here (edit, void, delete) are
 * the ledger's own, written once under the ledger's part rather than again
 * for every screen that lists entries.
 */

/** What the ledger's drawer asks, said once for both screens that open it. */
const EXPENSE_FIELDS = {
  direction: "always out here; the form does not ask",
  usdRate: "taka per dollar that day; asked on every entry",
  chargeAmount: "the bank's charge, saved as its own Bank charges row",
  withheldTaxAmount:
    "tax we withheld before paying; needs billAmount, the gross bill",
};

const EXPENSE_SAVE =
  "Writes one money-out entry from the chosen account; a bank charge becomes its own row. Refused in a locked period or if the account would go below zero. Then asks for the receipt.";

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
        does: "One heading: its sub-categories and every entry under it. The add button named for the heading records a payment under it.",
      },
      {
        href: "/expenses/other",
        name: "Other expenses",
        does: "Money out that is not tooling. Add expense records a payment.",
      },
    ],
    forms: [
      {
        name: "Record a movement",
        on: "/expenses/[category]",
        opens:
          "the add button named for the heading, top right, like add Office & premises",
        saves: ["POST /transactions"],
        schema: createTransactionSchema,
        fields: {
          ...EXPENSE_FIELDS,
          categoryId: "starts at this page's heading; any money-out category",
        },
        onSave: `${EXPENSE_SAVE} Shows on this heading's page.`,
        permission: "transactions.write",
        draft: "transaction_out",
      },
      {
        name: "Record a movement",
        on: "/expenses/other",
        opens: "Add expense, top right",
        saves: ["POST /transactions"],
        schema: createTransactionSchema,
        fields: EXPENSE_FIELDS,
        onSave: `${EXPENSE_SAVE} Shows on Other expenses.`,
        permission: "transactions.write",
        draft: "transaction_out",
      },
      {
        name: "Add a category",
        on: "/expenses",
        opens: "add category, top right, then Create a heading",
        saves: ["POST /categories"],
        schema: createCategorySchema,
        fields: {
          kind: "always out from here",
          parentId:
            "the heading it goes under; empty makes a heading of its own",
          color: "for the charts; a sub-category takes its heading's",
        },
        onSave:
          "Adds an expense heading, or a sub-category under one, to every expense form and screen and to Settings, Categories. Where it sits cannot be changed later. Refused when the name is taken there, or under a sub-category.",
        permission: "categories.write",
      },
    ],
    recordedBy: ["POST /transactions"],
    permission: "transactions.read",
    assistant: {
      drafts: ["transaction_out"],
      reads: ["find_transactions", "period_summary"],
      otherwise:
        "I cannot add or rename an expense heading or a sub-category. That is done under Settings, Categories, or with add category on Operational expenses.",
    },
  }),
];
