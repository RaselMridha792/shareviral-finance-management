import { appPart } from "../../common/app-map";

/**
 * Two folders with nothing in them yet (`bank-statements`,
 * `bank-reconciliation`). The Bank statement screen reads the ledger through
 * the account register; matching the books against the bank's own statement
 * line by line is not built.
 */
export const BANK_STATEMENT_MAP = [
  appPart({
    key: "bank_statement",
    name: "Bank statement",
    modules: ["bank-statements", "bank-reconciliation"],
    purpose:
      "One of our accounts, printed the way a bank prints a statement: every entry in a period with a running balance, voided ones shown struck through. It is the app's own ledger for that account, not the bank's file. Reconciling it against the bank's statement is not something the app does yet; a bank's statement that somebody has as a file can be staged through Import.",
    keeps: ["Nothing of its own. It is a view of the ledger for one account."],
    screens: [
      {
        href: "/statement",
        name: "Bank statement",
        does: "One account and a period: its entries with a running balance, laid out as a bank lays out a statement.",
      },
    ],
    recordedBy: [],
    permission: "transactions.read",
    assistant: {
      drafts: [],
      reads: ["find_transactions", "account_balances"],
      otherwise:
        "I cannot reconcile the books against the bank's statement: the app does not do that yet. The Bank statement screen shows one account's entries with a running balance.",
    },
  }),
];
