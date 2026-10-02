/**
 * The Assistant's mistakes, as they are kept and as they are told back to it
 * (2 Oct 2026, piece A2b).
 */
import type { AiIntakeReply } from "@finance/shared";

import {
  LEARNABLE_FIELDS,
  describeReply,
  diffDraft,
  maskDigits,
  proposedRule,
  renderReplyMistakes,
} from "./corrections";

const reply = (over: Partial<AiIntakeReply>): AiIntakeReply => ({
  target: null,
  draft: {},
  missingFields: [],
  nextQuestion: null,
  summary: null,
  clarification: null,
  ...over,
});

describe("what is learnt from a draft", () => {
  it("learns which plan a name means, and never a figure", () => {
    expect(LEARNABLE_FIELDS).toEqual(
      expect.arrayContaining([
        "subscriptionName",
        "toolName",
        "planName",
        "billingCycle",
      ]),
    );
    for (const field of LEARNABLE_FIELDS) {
      expect([field, /amount|cost|rate|usd|bdt|salary/i.test(field)]).toEqual([
        field,
        false,
      ]);
    }
  });

  it("keeps a renewal's plan when it was changed on the card", () => {
    expect(
      diffDraft(
        { subscriptionName: "Claude", usdRate: "122.5" },
        { subscriptionName: "Claude Code", usdRate: "125" },
      ),
    ).toEqual([
      {
        field: "subscriptionName",
        drafted: "Claude",
        corrected: "Claude Code",
      },
    ]);
  });
});

describe("an answer marked wrong", () => {
  it("says what was drafted and what was shown, without ids or notes", () => {
    const text = describeReply(
      reply({
        target: "transaction_out",
        draft: {
          amount: "2450",
          categoryName: "AI tools",
          accountId: "7f1c",
          notes: "for Rahim",
        },
        summary: "Draft ready",
      }),
    );
    expect(text).toContain("(transaction_out)");
    expect(text).toContain('categoryName "AI tools"');
    expect(text).toContain('said "Draft ready"');
    expect(text).not.toContain("accountId");
    expect(text).not.toContain("Rahim");
  });

  it("describes an answer that drafted nothing by what it said", () => {
    expect(
      describeReply(reply({ summary: "Team member er count dekhar tool nei" })),
    ).toBe('said "Team member er count dekhar tool nei"');
    expect(describeReply(reply({}))).toBe("gave no answer");
  });

  it("is masked before it is kept, all three texts", () => {
    expect(maskDigits('drafted amount "2450" on 2026-10-02')).toBe(
      'drafted amount "…" on …-…-…',
    );
    expect(maskDigits("৫০০০ taka, 42 jon")).toBe("… taka, … jon");
  });

  it("is told back to the model as a whole answer not to repeat", () => {
    const block = renderReplyMistakes([
      {
        said: "amader total team member kotojon?",
        drafted: 'said "no tool to count"',
        corrected: "Team screen e … jon ache, count kore bolo",
      },
    ]);
    expect(block).toMatch(/^ANSWERS SOMEBODY HERE MARKED WRONG/);
    expect(block).toContain(
      '"amader total team member kotojon?" → you said "no tool to count". They said: Team screen e … jon ache',
    );
    expect(renderReplyMistakes([])).toBe("");
  });
});

describe("the rule a mistake offers", () => {
  it("is one line the owner can change: what was asked, and what was right", () => {
    expect(
      proposedRule({
        kind: "reply",
        said: "Namecheap e domain renew korlam … dollar",
        field: null,
        corrected: "eta AI tools and subscriptions e jabe",
      }),
    ).toBe(
      '"Namecheap e domain renew korlam … dollar": eta AI tools and subscriptions e jabe',
    );
    expect(
      proposedRule({
        kind: "field",
        said: "DESCO bill dilam",
        field: "categoryName",
        corrected: "Electricity",
      }),
    ).toBe('"DESCO bill dilam" → category: Electricity');
    expect(
      proposedRule({
        kind: "field",
        said: "Claude Code er bill",
        field: "subscriptionName",
        corrected: "Claude",
      }),
    ).toBe('"Claude Code er bill" → subscription: Claude');
  });
});
