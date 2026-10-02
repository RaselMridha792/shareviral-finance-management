import { appPart } from "../../common/app-map";

/**
 * The ledger's three ways in: an entry, money arriving, and a transfer.
 * One table holds all three; the screens differ in what they ask for.
 */
export const TRANSACTIONS_MAP = [
  appPart({
    key: "transactions",
    name: "All transactions",
    modules: ["transactions"],
    purpose:
      "The ledger: every movement of money, in or out of one of our accounts, with a date, an amount in taka, a category and the day's USD rate. Every other money screen is a view of this list.",
    keeps: [
      "A plain payment to somebody outside the company, filed under an expense sub-category: rent, a bill, a purchase.",
      "Money received that is not a transfer between our own accounts.",
    ],
    screens: [
      {
        href: "/transactions",
        name: "All transactions",
        does: "Every entry, searchable and filtered by date, account, category and direction. A row opens the whole record; an entry is edited or voided from its row.",
      },
    ],
    recordedBy: ["POST /transactions"],
    permission: "transactions.read",
    assistant: {
      drafts: ["transaction_out", "transaction_in"],
      reads: ["find_transactions", "period_summary"],
      otherwise:
        "I cannot edit, void or delete an entry that is already recorded. That is done from its row on All transactions.",
    },
  }),

  appPart({
    key: "cash_in",
    name: "Cash In",
    modules: ["transactions"],
    purpose:
      "Money arriving, recorded off the bank's remittance advice: the CEO's funding from abroad most of all. The screen lists the month's money-in entries and the dollars each was sent as.",
    keeps: [
      "Money received from abroad: the taka that landed, the dollars that were sent, the rate, and the sender's bank.",
    ],
    screens: [
      {
        href: "/accounts/cash-in",
        name: "Cash In",
        does: "The month's money-in entries with their dollars and rate. Add cash records one; a row is corrected or voided here.",
      },
    ],
    recordedBy: ["POST /transactions/cash-in"],
    permission: "accounts.read",
    assistant: {
      // Drafted as an ordinary money-in entry (POST /transactions), which
      // shows on this screen too. The Cash In form itself asks no category.
      drafts: ["transaction_in"],
      reads: ["find_transactions"],
      otherwise:
        "The sender's bank details and the advice itself are attached on the Cash In screen.",
    },
  }),

  appPart({
    key: "transfers",
    name: "Money Transfer",
    modules: ["transactions"],
    purpose:
      "Money moved between two of our own accounts. Nothing was spent and nobody was paid: it is one account down and another up, kept as a linked pair of entries with no category.",
    keeps: [
      "A transfer between two of our own accounts, with the dollars beside it when a dollar account is on either side, and any bank charge as its own entry.",
    ],
    screens: [
      {
        href: "/transfers",
        name: "Money Transfer",
        does: "Every transfer, one row for the pair. A transfer is recorded, edited (both halves together) or trashed here.",
      },
    ],
    recordedBy: ["POST /transactions/transfer"],
    permission: "transactions.read",
    assistant: {
      drafts: ["transfer"],
      reads: ["find_transactions", "account_balances"],
      otherwise:
        "I cannot change a transfer that is already recorded. That is done on Money Transfer, where both halves change together.",
    },
  }),
];
