/**
 * AI tools and subscriptions: a plan, and its renewal, as drafts
 * (2 Oct 2026).
 *
 * The owner told the Assistant to buy an AI subscription and it recorded a
 * plain payment. These are the two records it should have drafted, held to
 * the same rule as every other: ready when the form's own endpoint would
 * take it, and not before. A new plan is the Add subscription form's record;
 * a renewal is the Renew drawer's.
 *
 * No database: what the books hold under a name is handed to the check.
 */
import { randomUUID } from "node:crypto";

import type { AiTarget } from "@finance/shared";

import {
  checkDraft,
  planLabels,
  plansLike,
  plansNamed,
  tidyDraft,
  type NameMatches,
} from "./draft-check";
import { fieldReferenceFor } from "./field-reference";

const EXPROVIA = { id: randomUUID(), name: "M/S. EXPROVIA", currency: "BDT" };
const CARD = { id: randomUUID(), name: "Master card", currency: "USD" };
const ACCOUNTS = [EXPROVIA.name, CARD.name];

const plan = (toolName: string, planName: string, status = "active") => ({
  id: randomUUID(),
  toolName,
  planName,
  status,
});
const CLAUDE = plan("Claude", "Max");
const CHATGPT_PLUS = plan("ChatGPT", "Plus");
const CHATGPT_TEAM = plan("ChatGPT", "Team");
const ZOOM_OLD = plan("Zoom", "Pro", "canceled");
const ZOOM = plan("Zoom", "Business");
const PLANS = [CLAUDE, CHATGPT_PLUS, CHATGPT_TEAM, ZOOM_OLD, ZOOM];

/** A plan as the books answer for it: what a renewal is filled from. */
const onFile = (
  row: { id: string; toolName: string },
  own: { payableUsd?: string | null; usdRate?: string | null; card?: boolean },
) => ({
  id: row.id,
  name: planLabels(PLANS).get(row.id) ?? row.toolName,
  plan: {
    payableUsd: own.payableUsd ?? null,
    usdRate: own.usdRate ?? null,
    account: own.card === false ? null : CARD,
  },
});

function check(
  target: AiTarget,
  draft: Record<string, unknown>,
  matches: NameMatches = {},
) {
  return checkDraft(target, tidyDraft(draft), matches, ACCOUNTS, PLANS);
}

const fieldsOf = (checked: ReturnType<typeof check>) =>
  checked.problems.map((problem) => problem.field);

/** Without one key, for a draft that is short of it. */
function without<T extends Record<string, unknown>>(draft: T, key: keyof T) {
  const rest = { ...draft };
  delete rest[key];
  return rest;
}

describe("a new plan, as the Add subscription form takes it", () => {
  const bought = {
    toolName: "Cursor",
    planName: "Pro",
    category: "ai_tool",
    costUsd: "20",
    usdRate: "122.5",
    startDate: "2026-10-02",
    accountName: "Master card",
  };

  it("is ready with the form's own fields, each as text", () => {
    const checked = check(
      "subscription",
      { ...bought, costUsd: "$20", usdRate: 122.5 },
      { accountName: [CARD] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.notes).toEqual([]);
    expect(checked.draft).toEqual(bought);
  });

  it("asks for the account: the price comes out of it when the plan is saved", () => {
    const checked = check("subscription", without(bought, "accountName"));

    expect(fieldsOf(checked)).toEqual(["accountName"]);
    expect(checked.problems[0].question).toBe(
      "Which card or account is it paid from? The price comes out of it when the plan is saved.",
    );
  });

  it("asks for the rate, unless the taka price was given beside the dollars", () => {
    const noRate = without(bought, "usdRate");

    expect(
      fieldsOf(check("subscription", noRate, { accountName: [CARD] })),
    ).toEqual(["usdRate"]);
    expect(
      check(
        "subscription",
        { ...noRate, costBdt: "2450" },
        { accountName: [CARD] },
      ).problems,
    ).toEqual([]);
  });

  it("asks for what the schema requires, the tool first", () => {
    const checked = check(
      "subscription",
      { usdRate: "122.5", accountName: "Master card" },
      { accountName: [CARD] },
    );

    expect(fieldsOf(checked)).toEqual([
      "toolName",
      "planName",
      "costUsd",
      "category",
      "startDate",
    ]);
    expect(checked.problems[0].question).toBe("Which tool or service is it?");
  });

  it("refuses three figures that do not agree, in the form's words", () => {
    const checked = check(
      "subscription",
      { ...bought, costBdt: "9999" },
      { accountName: [CARD] },
    );

    expect(fieldsOf(checked)).toEqual(["costBdt"]);
    expect(checked.problems[0].question).toMatch(
      /The dollar price, the taka price and the rate do not agree/,
    );
  });

  it("reads a category and a cycle written the form's way", () => {
    for (const written of ["AI Tool", "ai-tool", "Ai tool"]) {
      const checked = check(
        "subscription",
        { ...bought, category: written, billingCycle: "Monthly" },
        { accountName: [CARD] },
      );
      expect(checked.problems).toEqual([]);
      expect(checked.draft).toMatchObject({
        category: "ai_tool",
        billingCycle: "monthly",
      });
    }
    // One that is none of the ten is asked for again.
    expect(
      fieldsOf(
        check(
          "subscription",
          { ...bought, category: "gadgets" },
          { accountName: [CARD] },
        ),
      ),
    ).toEqual(["category"]);
  });

  it("drops what is the screen's to say: the status, and who is on it", () => {
    const checked = check(
      "subscription",
      {
        ...bought,
        status: "canceled",
        users: "Rahim",
        categoryName: "AI tools",
      },
      { accountName: [CARD] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).toEqual(bought);
  });

  it("asks, when the tool is on file and no plan was named: more likely a renewal", () => {
    const checked = check(
      "subscription",
      { ...without(bought, "planName"), toolName: "claude" },
      { accountName: [CARD] },
    );

    expect(fieldsOf(checked)).toEqual(["planName"]);
    expect(checked.problems[0].question).toBe(
      "claude is on file already: Claude › Max. Is this a renewal, or a new plan? If it is new, which plan is it?",
    );
  });

  it("says so beside the draft when the same plan is on file, and refuses nothing", () => {
    const checked = check(
      "subscription",
      { ...bought, toolName: "Claude", planName: "max" },
      { accountName: [CARD] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.notes).toEqual([
      "Claude is already on file. If this is its renewal, say so and I will draft that instead of a second plan.",
    ]);
  });

  it("says what is on file when another plan of the tool is running", () => {
    const checked = check(
      "subscription",
      { ...bought, toolName: "Zoom", planName: "Pro" },
      { accountName: [CARD] },
    );

    // Zoom › Business is running; Zoom › Pro is the cancelled one.
    expect(checked.problems).toEqual([]);
    expect(checked.notes).toEqual([
      "Zoom is on file already: Zoom › Business. If this is its renewal, say so. If that plan was changed to this one, that is an Upgrade, on the plan's row. Otherwise this is added as a second plan.",
    ]);
  });

  it("is not held against a tool nobody has on file", () => {
    const checked = check("subscription", bought, { accountName: [CARD] });
    expect(checked.notes).toEqual([]);
  });

  it("asks again for a price or a rate of nothing", () => {
    const zero = check(
      "subscription",
      { ...bought, costUsd: "0" },
      { accountName: [CARD] },
    );
    expect(fieldsOf(zero)).toEqual(["costUsd"]);
    expect(zero.problems[0].question).toBe(
      "Price in dollars \"0\" cannot be saved: a plan's price has to be more than zero. What is the plan's price, in dollars?",
    );
    expect(zero.draft).not.toHaveProperty("costUsd");

    expect(
      fieldsOf(
        check(
          "subscription",
          { ...bought, usdRate: "0.00" },
          { accountName: [CARD] },
        ),
      ),
    ).toEqual(["usdRate"]);
  });
});

describe("a renewal, as the Renew drawer takes it", () => {
  it("is filled from the plan, and asks for this renewal's rate", () => {
    const checked = check(
      "subscription_payment",
      { subscriptionName: "claude", txnDate: "2026-10-02" },
      {
        subscriptionName: [
          onFile(CLAUDE, { payableUsd: "100.00", usdRate: "122.500000" }),
        ],
      },
    );

    expect(fieldsOf(checked)).toEqual(["usdRate"]);
    expect(checked.problems[0].question).toBe(
      "What rate was this renewal charged at? The plan's own is 122.5.",
    );
    // The plan's own price and card are on the card, for the person to check.
    expect(checked.draft).toEqual({
      subscriptionName: "Claude",
      txnDate: "2026-10-02",
      usdAmount: "100.00",
      accountName: "Master card",
    });
  });

  it("is ready once the rate is given", () => {
    const checked = check(
      "subscription_payment",
      { subscriptionName: "Claude", txnDate: "2026-10-02", usdRate: 121.75 },
      {
        subscriptionName: [
          onFile(CLAUDE, { payableUsd: "100.00", usdRate: "122.5" }),
        ],
      },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).toMatchObject({
      usdAmount: "100.00",
      usdRate: "121.75",
      accountName: "Master card",
    });
  });

  it("keeps what the person said over what the plan holds", () => {
    const checked = check(
      "subscription_payment",
      {
        subscriptionName: "Claude",
        txnDate: "2026-10-02",
        usdRate: "121.75",
        usdAmount: "$120",
        accountName: "exprovia",
      },
      {
        subscriptionName: [onFile(CLAUDE, { payableUsd: "100.00" })],
        accountName: [EXPROVIA],
      },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).toMatchObject({
      usdAmount: "120",
      accountName: "M/S. EXPROVIA",
    });
  });

  it("shows the dollars the entry will carry, when only the taka was given", () => {
    // The endpoint writes the plan's price as the entry's dollars when none
    // are stated: on the card, where they can be corrected, not unseen.
    const checked = check(
      "subscription_payment",
      {
        subscriptionName: "Claude",
        txnDate: "2026-10-02",
        usdRate: "125",
        amount: "30,000",
      },
      { subscriptionName: [onFile(CLAUDE, { payableUsd: "200.00" })] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).toMatchObject({
      amount: "30000",
      usdAmount: "200.00",
    });
  });

  it("asks again for dollars, a rate or an amount of nothing", () => {
    const zero = check(
      "subscription_payment",
      {
        subscriptionName: "Claude",
        txnDate: "2026-10-02",
        usdRate: "0",
        usdAmount: "0.00",
      },
      { subscriptionName: [onFile(CLAUDE, { payableUsd: "100.00" })] },
    );

    expect(fieldsOf(zero)).toEqual(["usdAmount", "usdRate"]);
    // Not quietly replaced by the plan's own price.
    expect(zero.draft).not.toHaveProperty("usdAmount");
    expect(zero.problems[0].question).toMatch(
      /^Amount in dollars "0.00" cannot be saved: what the card was billed has to be more than zero\./,
    );
  });

  it("offers the plan it might have meant, and does not take it", () => {
    const checked = check(
      "subscription_payment",
      {
        subscriptionName: "Claude Code",
        txnDate: "2026-10-02",
        usdRate: "122",
      },
      { subscriptionName: [] },
    );

    expect(fieldsOf(checked)).toEqual(["subscriptionName"]);
    expect(checked.problems[0].question).toBe(
      'There is no plan called "Claude Code" under AI tools and subscriptions. Did you mean Claude? If it is a new plan, say so.',
    );
    expect(checked.draft).not.toHaveProperty("usdAmount");
    expect(checked.draft).not.toHaveProperty("accountName");
  });

  it("asks which plan, when there is none of that name — and offers the ones on file", () => {
    const checked = check(
      "subscription_payment",
      { subscriptionName: "Zylofone Pro", txnDate: "2026-10-02" },
      { subscriptionName: [] },
    );

    expect(fieldsOf(checked)).toEqual(["subscriptionName", "usdRate"]);
    expect(checked.problems[0].question).toBe(
      // Zoom has two plans on file, so it is written with its plan — and the
      // cancelled one is not offered.
      'There is no plan called "Zylofone Pro" under AI tools and subscriptions. Is it a new plan, or which one on file is it? On file: Claude, ChatGPT › Plus, ChatGPT › Team or Zoom › Business.',
    );
    // Nothing is filled in for a plan that is not there.
    expect(checked.draft).toEqual({ txnDate: "2026-10-02" });
  });

  it("asks which plan, when a tool has two", () => {
    const checked = check(
      "subscription_payment",
      { subscriptionName: "ChatGPT", txnDate: "2026-10-02", usdRate: "122" },
      {
        subscriptionName: [
          onFile(CHATGPT_PLUS, { payableUsd: "20.00" }),
          onFile(CHATGPT_TEAM, { payableUsd: "60.00" }),
        ],
      },
    );

    expect(fieldsOf(checked)).toEqual(["subscriptionName"]);
    expect(checked.problems[0].question).toBe(
      '"ChatGPT" could be ChatGPT › Plus or ChatGPT › Team. Which one?',
    );
    expect(checked.draft).not.toHaveProperty("usdAmount");
  });

  it("asks for what the plan itself is missing", () => {
    const checked = check(
      "subscription_payment",
      { subscriptionName: "Claude", txnDate: "2026-10-02", usdRate: "122" },
      {
        subscriptionName: [onFile(CLAUDE, { payableUsd: "0.00", card: false })],
      },
    );

    expect(fieldsOf(checked)).toEqual(["accountName", "usdAmount"]);
    expect(checked.problems[0].question).toBe(
      "The plan has no card or account on it. Which card or account was it paid from?",
    );
    expect(checked.problems[1].question).toBe(
      "The plan has no price on it. How many dollars was the card billed?",
    );
  });

  it("drops what a renewal has no box for, and what is the app's to send", () => {
    const checked = check(
      "subscription_payment",
      {
        subscriptionName: "Claude",
        txnDate: "2026-10-02",
        usdRate: "122",
        categoryName: "AI tools",
        advanceRenewal: false,
        subscriptionId: randomUUID(),
        vendorName: "Anthropic",
        description: "Claude renewal",
      },
      { subscriptionName: [onFile(CLAUDE, { payableUsd: "100.00" })] },
    );

    expect(checked.problems).toEqual([]);
    expect(Object.keys(checked.draft).sort()).toEqual([
      "accountName",
      "subscriptionName",
      "txnDate",
      "usdAmount",
      "usdRate",
    ]);
  });

  it("refuses a bank charge stated twice", () => {
    const checked = check(
      "subscription_payment",
      {
        subscriptionName: "Claude",
        txnDate: "2026-10-02",
        usdRate: "122",
        chargeAmount: "115",
        chargeUsd: "1",
      },
      { subscriptionName: [onFile(CLAUDE, { payableUsd: "100.00" })] },
    );

    expect(fieldsOf(checked)).toEqual(["chargeUsd"]);
  });
});

describe("which plan a name means", () => {
  const named = (said: string) =>
    plansNamed(PLANS, said).map(
      (row) => planLabels(PLANS).get(row.id) ?? row.toolName,
    );

  it("takes the tool's own name, however it is cased", () => {
    expect(named("claude")).toEqual(["Claude"]);
    expect(named("Claude › Max")).toEqual(["Claude"]);
    expect(named("Claude Max")).toEqual(["Claude"]);
  });

  it("never takes a name that only resembles a plan: money would go to the wrong one", () => {
    // "Claude Code" is not the plan called Claude; "GitHub" is not "Git".
    expect(named("Claude Code")).toEqual([]);
    expect(named("the claude subscription")).toEqual([]);
    expect(named("max")).toEqual([]);
    expect(plansNamed([plan("Git", "Pro"), CLAUDE], "GitHub Copilot")).toEqual(
      [],
    );
  });

  it("offers what it might have meant, sharing a whole word, and never cancelled", () => {
    const like = (said: string) =>
      plansLike(PLANS, said).map(
        (row) => planLabels(PLANS).get(row.id) ?? row.toolName,
      );
    expect(like("the claude subscription")).toEqual(["Claude"]);
    expect(like("Claude Code")).toEqual(["Claude"]);
    expect(like("max")).toEqual(["Claude"]);
    expect(like("zoom pro")).toEqual(["Zoom › Business"]);
    expect(like("GitHub Copilot")).toEqual([]);
  });

  it("tells two rows of one tool and one plan apart by who each is for", () => {
    const rahim = { ...plan("ChatGPT", "Plus"), hint: "Rahim" };
    const karim = { ...plan("ChatGPT", "Plus"), hint: "Karim" };
    const rows = [rahim, karim, CHATGPT_TEAM];
    const labels = planLabels(rows);

    expect(labels.get(rahim.id)).toBe("ChatGPT › Plus (Rahim)");
    expect(labels.get(CHATGPT_TEAM.id)).toBe("ChatGPT › Team");
    expect(plansNamed(rows, "ChatGPT › Plus")).toEqual([rahim, karim]);
    expect(plansNamed(rows, "ChatGPT › Plus (Karim)")).toEqual([karim]);
  });

  it("returns every plan of a tool that has several, and one when it is written whole", () => {
    expect(named("chatgpt")).toEqual(["ChatGPT › Plus", "ChatGPT › Team"]);
    expect(named("ChatGPT › Team")).toEqual(["ChatGPT › Team"]);
    expect(named("chatgpt > plus")).toEqual(["ChatGPT › Plus"]);
  });

  it("prefers a plan that is running to one that was cancelled", () => {
    expect(plansNamed(PLANS, "zoom")).toEqual([ZOOM]);
    expect(plansNamed([ZOOM_OLD], "zoom")).toEqual([ZOOM_OLD]);
  });

  it("finds nothing for a tool that is not on file", () => {
    expect(named("Zylofone Pro")).toEqual([]);
  });
});

describe("the field list for a plan and for a renewal", () => {
  it("asks a new plan for its account and its rate, as the form does", () => {
    const reference = fieldReferenceFor("subscription");

    for (const field of [
      "toolName",
      "planName",
      "category",
      "costUsd",
      "startDate",
      "usdRate",
      "accountName",
    ]) {
      expect(reference).toMatch(new RegExp(`^\\s+${field}\\s+REQUIRED`, "m"));
    }
    expect(reference).toMatch(
      /costUsd\s+REQUIRED\s+the plan's price .* DOLLARS/,
    );
    expect(reference).toMatch(/chargeUsd\s+optional\s+what the VENDOR charges/);
    // The screen's to say, and an id only the books can give.
    expect(reference).not.toMatch(/^\s+(status|users|accountId)\s/m);
  });

  it("asks a renewal for its plan, its date and its rate — and for no category", () => {
    const reference = fieldReferenceFor("subscription_payment");

    for (const field of ["subscriptionName", "txnDate", "usdRate"]) {
      expect(reference).toMatch(new RegExp(`^\\s+${field}\\s+REQUIRED`, "m"));
    }
    expect(reference).toMatch(
      /usdAmount\s+optional\s+what the card was billed/,
    );
    expect(reference).toMatch(/chargeUsd\s+optional\s+the BANK's charge/);
    expect(reference).not.toMatch(
      /categoryName|categoryId|advanceRenewal|subscriptionId/,
    );
  });

  it("leaves the other records' lists as they were", () => {
    expect(fieldReferenceFor("transfer")).toMatch(
      /usdAmount\s+optional\s+the DOLLARS that moved/,
    );
    expect(fieldReferenceFor("transaction_out")).toMatch(
      /chargeUsd\s+optional\s+the bank's charge in DOLLARS/,
    );
    expect(fieldReferenceFor("transaction_out")).not.toMatch(
      /subscriptionName|subscriptionId/,
    );
  });
});
