import { appPart } from "../../common/app-map";

export const ACCOUNTS_MAP = [
  appPart({
    key: "accounts",
    name: "Accounts",
    modules: ["accounts"],
    purpose:
      "The company's own bank, cash and mobile-wallet accounts, each with an opening balance. An account's balance is its opening balance plus every entry against it. An account marked USD is the one kept for foreign spend; its figures in the ledger are still taka.",
    keeps: [
      "An account itself: its name, kind, opening balance, and a card's details.",
    ],
    screens: [
      {
        href: "/accounts",
        name: "Accounts overview",
        does: "Every account as a card with what it holds. An account is added, edited, archived or deleted here.",
      },
      {
        href: "/accounts/[id]",
        name: "An account's own page",
        does: "One account: its details and what it holds.",
      },
      {
        href: "/accounts/[id]/register",
        name: "An account's register",
        does: "Every entry against that account, in date order, with a running balance.",
      },
    ],
    recordedBy: ["POST /accounts", "PATCH /accounts/:id"],
    permission: "accounts.read",
    assistant: {
      drafts: [],
      reads: ["account_balances"],
      otherwise:
        "I cannot add or change an account. That is done on Accounts overview. I can tell you what each account holds.",
    },
  }),
];
