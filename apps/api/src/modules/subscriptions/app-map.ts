import {
  createSubscriptionSchema,
  updateSubscriptionSchema,
} from "@finance/shared";

import { appPart } from "../../common/app-map";
// A file of its own with no imports from this app: no cycle through here.
import { paySubscriptionSchema } from "../transactions/pay-subscription.schema";

/**
 * The part the owner's complaint was about (2 Oct 2026): told to buy an AI
 * subscription, the Assistant recorded a plain payment, and this page showed
 * nothing. The owner's rule, the same day: anything called a subscription
 * belongs here — software, AI tools, hosting and servers, and domains —
 * recorded as a plan, and filed under the "Ai Tools and Subscriptions"
 * heading.
 *
 * How a plan and its payments are tied: a plan is a row of `subscriptions`.
 * Adding one takes its first payment at once (the Add subscription form
 * posts the plan, then pays it). A renewal is `POST /subscriptions/:id/pay`:
 * an ordinary money-out entry that carries the plan's id
 * (`transactions.subscription_id`), is filed under the tooling heading by
 * the endpoint itself, and moves the plan's next renewal date on. That id is
 * what makes a payment count as tooling on Expense overview. A plain payment
 * carries none, which is why it showed on All transactions and nowhere here.
 */
export const SUBSCRIPTIONS_MAP = [
  appPart({
    key: "subscriptions",
    name: "AI tools and subscriptions",
    modules: ["subscriptions"],
    purpose:
      "The register of everything the company subscribes to: software, AI tools, hosting and servers, and domains. Each is a plan: the tool, the plan's name, its price in dollars, the rate, how often it renews, the card it is paid from, who it was bought for and who is on it. Its payments are entries in the ledger that carry the plan.",
    keeps: [
      "A new subscription, of anything: a plan. Adding one records its first payment from the plan's account on the day it was bought.",
      "A renewal, or any payment for a plan already on file: a payment on that plan. A plan renews once a month.",
      "An upgrade of a plan: the plan's name and price change in place, with the vendor's charge for it.",
      "Never a plain payment. A subscription recorded as a plain payment shows on All transactions and not here, and is not counted as tooling.",
    ],
    screens: [
      {
        href: "/subscriptions",
        name: "AI tools and subscriptions",
        does: "The plans running in a month, with price, renewal date and card. Add a subscription adds a plan and takes its first payment; a row offers Renew, Upgrade and Edit, and opens the whole plan.",
      },
      {
        href: "/subscriptions/[id]",
        name: "A plan's own page",
        does: "One plan, whole: what it costs, how it is paid, who it is for, who is on it.",
      },
    ],
    // DELETE /subscriptions/:id is named by no form: nothing calls it. Move to
    // trash goes through the trash, and a finished plan is cancelled instead.
    forms: [
      {
        name: "Add a subscription",
        on: "/subscriptions",
        opens: "Add a subscription, top right",
        saves: ["POST /subscriptions", "POST /subscriptions/:id/pay"],
        schema: createSubscriptionSchema,
        fields: {
          costUsd: "the plan's price for one cycle, in dollars",
          usdRate: "taka per dollar the price is read at",
          costBdt: "the price in taka; any two of the three give the third",
          chargeUsd: "what the card adds on top each cycle, in dollars",
          accountId: "the card or account it is paid from; needed when active",
          boughtFor: "the department it is for; on screen, User Department",
        },
        onSave:
          "Adds the plan. If it is active, its first payment then leaves its account on the start date, under the AI tools heading; if that payment is refused, the plan stays and Renew takes it.",
        permission: "vendors.write",
        draft: "subscription",
      },
      {
        name: "Edit",
        on: "/subscriptions",
        opens: "Edit, on a plan's row or in its popup",
        saves: ["PATCH /subscriptions/:id"],
        schema: updateSubscriptionSchema,
        fields: {
          users: "the whole list when sent; anyone left out comes off",
        },
        onSave:
          "Changes the plan in place and never takes money. The renewal date moves only when the start date or the cycle changes, and the three prices must agree.",
        permission: "vendors.write",
      },
      {
        name: "Change status",
        on: "/subscriptions",
        opens: "Change status, on a plan's row",
        saves: ["PATCH /subscriptions/:id"],
        onSave:
          "Pauses an active plan, or puts a paused, cancelled or expired one back to active. Nothing moves in the ledger. Cancelling is done in Edit.",
        permission: "vendors.write",
      },
      {
        name: "Renew",
        on: "/subscriptions",
        opens: "Renew, on a plan's row or in its popup",
        saves: ["POST /subscriptions/:id/pay"],
        schema: paySubscriptionSchema,
        fields: {
          amount: "taka charged; blank: the dollars at this payment's rate",
          usdAmount: "dollars billed; blank: the plan's price plus its charge",
          usdRate: "blank: the plan's own rate",
          accountId: "blank: the plan's own card",
          categoryId: "blank: the AI tools heading",
          chargeUsd: "the bank's fee in dollars, written as its own row",
          advanceRenewal: "move the renewal date on a cycle; on by default",
        },
        onSave:
          "Records a money-out entry on the plan's card, tied to the plan and filed under the AI tools heading, and moves the renewal date on. Refused if already renewed that month, in a locked month, or below zero.",
        permission: "transactions.write",
        draft: "subscription_payment",
      },
      {
        // The controller validates with `upgradeSubscriptionSchema`, which it
        // does not export, so the fields are named here by hand.
        name: "Upgrade",
        on: "/subscriptions",
        opens: "Upgrade, on a plan's row or in its popup",
        saves: ["POST /subscriptions/:id/upgrade"],
        fields: {
          upgradedOn: "required; the day the new plan started",
          toPlanName: "required; the new plan's name",
          toCostUsd: "required; the new price per cycle, in dollars",
          toChargeUsd: "what the card adds on top each cycle, in dollars",
          usdRate:
            "required; taka per dollar for the new price and today's charge",
          chargedUsd:
            "what the vendor charged today for the upgrade; empty for nothing",
          chargedBdt: "the taka that charge came to, if not dollars × rate",
          bankChargeUsd: "the bank's fee on today's charge, in dollars",
          nextRenewalOn: "only when the vendor moved the billing date",
          note: "a few words on why",
        },
        onSave:
          "Changes the plan's name and price in place and keeps the old ones as history. A charge today becomes a payment from the plan's card that is not counted as the month's renewal. Needs transactions.write as well.",
        permission: "vendors.write",
      },
    ],
    recordedBy: ["POST /subscriptions", "POST /subscriptions/:id/pay"],
    permission: "vendors.read",
    assistant: {
      drafts: ["subscription", "subscription_payment"],
      reads: ["find_subscriptions"],
      otherwise:
        "I cannot upgrade, pause, cancel or edit a plan, or change who is on it. That is done from the plan's row on AI tools and subscriptions: Upgrade, Edit, and the status there.",
      oneAtATime:
        "I draft plans and renewals one at a time, so that each is checked against the plan on file and its own rate is asked. Which one first?",
    },
    claims: {
      from: ["transaction_out", "vendor"],
      // The headings and sub-categories a plan's payment is filed under, and
      // the Technology ones the owner named as the same thing.
      categories:
        /\bai\b[\s-]*tools?|subscriptions?|software|hosting|servers?|domains?/i,
      words:
        /subscriptions?|subscribtions?|subcriptions?|সাবস্ক্রিপশন|সাবসক্রিপশন/i,
      vendorTypes: ["ai_tool", "subscription", "hosting"],
      say: "A subscription is recorded as a plan under AI tools and subscriptions, not as a plain payment. Is this a new plan, or the renewal of one already on file?",
      sayAgain:
        "I can record a subscription only as a plan under AI tools and subscriptions, or as a plan's renewal, never as a plain payment. Tell me which of the two it is. If it is neither, it has to be entered on the ordinary form.",
      sayOfAFile:
        "These rows are subscriptions. Each is a plan under AI tools and subscriptions, or a plan's renewal, and Import takes plain entries only: staged there they would show on All transactions and not on that page. They are added on AI tools and subscriptions, or here one at a time.",
    },
  }),
];
