import { appPart } from "../../common/app-map";

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
        does: "The plans running in a month, with price, renewal date and card. Add subscription adds a plan and takes its first payment; a row offers Renew, Upgrade and Edit, and opens the whole plan.",
      },
      {
        href: "/subscriptions/[id]",
        name: "A plan's own page",
        does: "One plan, whole: what it costs, how it is paid, who it is for, who is on it.",
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
