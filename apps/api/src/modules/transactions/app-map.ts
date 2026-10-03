import {
  createTransactionSchema,
  recordCashInSchema,
  transferSchema,
  updateTransactionSchema,
  voidTransactionSchema,
} from "@finance/shared";

import { appPart, INVOICE_AND_REFERENCE } from "../../common/app-map";

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
        does: 'Every entry, searchable and filtered by date, account, category, direction and origin. The origin "Added by the assistant" lists every entry saved through Confirm and save in the Assistant, of every kind. A row opens the whole record; an entry is edited or voided from its row.',
      },
    ],
    // Nothing is created on All transactions itself: money out starts on an
    // Expenses screen (its "Record a movement" is under the expenses part),
    // money in on Cash In. A money-in entry through POST /transactions is
    // reached only from the Assistant's draft card.
    forms: [
      {
        name: "The draft",
        on: "/assistant",
        opens:
          "the draft card for money in (no screen records money in this way)",
        saves: ["POST /transactions"],
        schema: createTransactionSchema,
        fields: {
          direction: "in; the card sets it",
          categoryId: "a money-in category; required here, unlike on Add cash",
          usdRate: "taka per dollar on the day; asked on every entry",
          originalAmount:
            "the dollars sent, when it came from abroad; fxRate with it",
          senderAccountName: "who sent it",
        },
        onSave:
          "Records a money-in entry under a money-in category; a bank charge becomes its own money-out row. Refused in a locked month. Shows on All transactions and Cash In. On screen, money in is recorded with Add cash.",
        permission: "transactions.write",
        draft: "transaction_in",
        worthAsking: INVOICE_AND_REFERENCE,
      },
      {
        name: "Edit",
        on: "/transactions",
        opens: "Edit, on an entry's row (the same on Expenses and a register)",
        saves: ["PATCH /transactions/:id"],
        schema: updateTransactionSchema,
        fields: {
          chargeAmount:
            "rewrites the bank charge; 0.00 takes it off, absent leaves it",
        },
        onSave:
          "Changes the entry in place. The account and the direction never change: that is a void and a new entry. Refused on a voided entry, half a transfer, a locked month, or if the account would go below zero.",
        permission: "transactions.write",
      },
      {
        name: "Void",
        on: "/transactions",
        opens: "Void, on an entry's row (the same on Expenses and a register)",
        saves: ["POST /transactions/:id/void"],
        schema: voidTransactionSchema,
        fields: { reason: "why; kept with the entry" },
        onSave:
          "Voids the entry: it stays, struck through, out of every total, with the reason. Its bank charge, and a transfer's other half, go with it. Allowed in a locked month; refused if an account would go below zero.",
        permission: "transactions.void",
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
    forms: [
      {
        name: "Add cash",
        on: "/accounts/cash-in",
        opens: "Add cash, top right",
        saves: ["POST /transactions/cash-in"],
        schema: recordCashInSchema,
        fields: {
          accountId: "our account it landed in; on screen, Received Bank Name",
          amount: "the taka that landed; on a USD account, dollars × rate",
          usdRate: "the day's rate; it governs the whole month",
          usdSent: "the dollars sent; blank for a local receipt",
          senderAccountName:
            "who sent it, e.g. ShareViral Corp; on screen, Sender",
          chargeAmount: "the bank's cut in taka, or chargeUsd in dollars",
        },
        onSave:
          "Records a money-in entry with no category, the rate and the dollars sent beside it; a bank charge becomes its own money-out row. Refused in a locked month. Shows here and on All transactions.",
        permission: "transactions.write",
      },
      {
        name: "Edit",
        on: "/accounts/cash-in",
        opens: "Edit, on a receipt's row",
        saves: ["PATCH /transactions/:id"],
        schema: updateTransactionSchema,
        fields: {
          chargeAmount: "rewrites the bank charge; 0.00 takes it off",
        },
        onSave:
          "Corrects the receipt in place: date, amount, description, bank charge, sender, note. The account never changes, and the dollars sent and the rate stay as first recorded. Refused on a voided entry or in a locked month.",
        permission: "transactions.write",
      },
      {
        name: "Void",
        on: "/accounts/cash-in",
        opens: "Void, on a receipt's row",
        saves: ["POST /transactions/:id/void"],
        schema: voidTransactionSchema,
        fields: { reason: "why; kept with the entry" },
        onSave:
          "Voids the receipt and its bank charge: they stay, struck through, out of every total, with the reason. Refused if the account would then go below zero.",
        permission: "transactions.void",
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
    forms: [
      {
        name: "Move money between accounts",
        on: "/transfers",
        opens: "New transfer, top right",
        saves: ["POST /transactions/transfer"],
        schema: transferSchema,
        fields: {
          amount: "the taka moved; on a USD account, dollars × rate",
          usdAmount:
            "the dollars moved, when a dollar account is on either side",
          usdRate: "taka per dollar on the day; on both halves",
          chargeAmount: "the bank's fee in taka, a row on the From account",
          chargeUsd: "or that fee in dollars; never both",
        },
        onSave:
          "Writes two linked entries with no category: out of the From account, into the To account. A bank charge is its own row on the From account. Refused in a locked month, or below zero on the From account.",
        permission: "transactions.write",
        draft: "transfer",
        worthAsking: INVOICE_AND_REFERENCE,
      },
      {
        // The controller validates with `updateTransferSchema`, which it does
        // not export, so the fields are named here by hand.
        name: "Edit",
        on: "/transfers",
        opens: "Edit, on a transfer's row or in its popup",
        saves: ["PATCH /transactions/transfer/:id"],
        fields: {
          txnDate: "required; the day it moved",
          amount: "required; the taka moved",
          usdRate: "required; taka per dollar on the day",
          usdAmount: "the dollars moved; empty clears them",
          chargeAmount: "the bank's fee in taka; empty takes it off",
          chargeUsd: "or that fee in dollars; never both",
          description: "required; what it was for",
          paymentMethod: "required; how it moved; on screen, Method",
        },
        onSave:
          "Rewrites both halves and the bank charge together; an empty box means none. The accounts never change: that is a void and a new transfer. Refused on a voided transfer, in a locked month, or below zero on either account.",
        permission: "transactions.write",
      },
      {
        name: "Void",
        on: "/transfers",
        opens: "Void, on a transfer's row",
        saves: ["POST /transactions/:id/void"],
        schema: voidTransactionSchema,
        fields: { reason: "why; kept with the transfer" },
        onSave:
          "Voids both halves and the bank charge together: they stay, struck through, out of every total, with the reason. Refused if either account would then go below zero.",
        permission: "transactions.void",
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
