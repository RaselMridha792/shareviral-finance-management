import { createAccountSchema, updateAccountSchema } from "@finance/shared";

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
    forms: [
      {
        name: "Add an account",
        on: "/accounts",
        opens: "Add account, top right",
        saves: ["POST /accounts"],
        schema: createAccountSchema,
        fields: {
          type: "bank, cash, mobile_wallet or card",
          currency:
            "BDT, or USD for the foreign-spend account; amounts stay taka",
          openingBalance: "taka held on the opening date; never below zero",
          openingBalanceUsd:
            "the same opening in dollars, for a USD account only",
          openingBalanceOn: "the day the opening balance was held",
          cardNumber:
            "a card's full number; encrypted, only its last four shown",
        },
        onSave:
          "Adds the account with its opening balance; no ledger entry is written. It shows as a card on Accounts overview and in every account picker. Refused when the name is taken or the opening is below zero.",
        permission: "accounts.write",
      },
      {
        name: "Edit account",
        on: "/accounts",
        opens:
          "the pencil on an account's card (also Edit, top right of its own page)",
        saves: ["PATCH /accounts/:id"],
        schema: updateAccountSchema,
        fields: {
          openingBalance: "changing it moves every balance after it",
          isActive: "not on the form; Archive and Restore set it",
          cardNumber:
            "always opens empty; blank keeps the stored number, a new one replaces it",
          cardCvc: "always opens empty; blank keeps the stored CVC",
        },
        onSave:
          "Changes the account's details; no entry is written. A new opening balance or date is refused in a locked period, and a lower opening is refused if the account would then dip below zero on any day.",
        permission: "accounts.write",
      },
      {
        name: "Archive",
        on: "/accounts",
        opens: "the archive icon on an active account's card",
        saves: ["POST /accounts/:id/archive"],
        onSave:
          "Archives the account at once, with no confirmation. Its entries and balance stay; it moves under Archived on Accounts overview and leaves the account pickers and the Total held. Restore puts it back.",
        permission: "accounts.write",
      },
      {
        name: "Restore",
        on: "/accounts",
        opens: "the restore icon on an archived account's card",
        saves: ["POST /accounts/:id/restore"],
        onSave:
          "Puts an archived account back in use at once: it returns among the active cards, to the Total held and to the account pickers. Nothing else changes.",
        permission: "accounts.write",
      },
      {
        name: "Delete",
        on: "/accounts",
        opens:
          "the bin on an archived account's card, confirmed by typing its name",
        saves: ["DELETE /accounts/:id"],
        onSave:
          "Removes an archived account for good. Refused unless nothing points at it: no entries, payroll run, TDS challan or tax payment. Such an account stays archived, already out of every picker. An account in use is archived first.",
        permission: "accounts.write",
      },
      {
        // Reads, but by POST: the password goes in the body, not the address.
        name: "Show the card",
        on: "/accounts/[id]",
        opens: "Show the number, in the Card panel, once a number is on file",
        saves: ["POST /accounts/:id/card-secrets"],
        fields: {
          cardPassword:
            "the shared card password, not a sign-in one; never asked in chat",
        },
        onSave:
          "Changes nothing: reads the card's full number and CVC back once, shown until the drawer closes. Every reveal and every wrong password is audited; five wrong ones lock the person out for five minutes. Refused until a card password is set.",
        permission: "accounts.write",
      },
      {
        name: "Card password",
        on: "/settings",
        opens:
          "Your sign-in section, Card password panel: Set it, or Change it once one is set",
        saves: ["POST /accounts/card-password"],
        fields: {
          current: "the card password now; asked only once one is set",
          next: "the new card password, at least 8 characters, typed twice",
        },
        onSave:
          "Sets or changes the one shared password that unlocks every card's number and CVC; changing needs the current one. It works at once for everybody, nothing stored is re-encrypted, and the audit log records the change, never the value.",
        permission: "settings.write",
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
