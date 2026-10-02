/**
 * Where a draft belongs is decided against the map, whatever the model said
 * (2 Oct 2026).
 *
 * The first case is the owner's: told to buy an AI subscription, the
 * Assistant recorded a plain payment. All transactions showed it; the AI
 * tools and subscriptions page showed nothing.
 */
import { randomUUID } from "node:crypto";

import {
  areaOf,
  claimOn,
  planNamedIn,
  refusalOf,
  tableRefusalOf,
  type RouteContext,
} from "./routing";

const asked = (
  said: string,
  categories: RouteContext["categories"] = [],
  role: RouteContext["role"] = "cfo",
  more: Partial<RouteContext> = {},
): RouteContext => ({
  role,
  said,
  categories,
  draftOpen: false,
  lastAnswer: null,
  ...more,
});

const BELONGS =
  "A subscription is recorded as a plan under AI tools and subscriptions, not as a plain payment. Is this a new plan, or the renewal of one already on file?";

const payment = {
  amount: "2450",
  accountName: "Master card",
  usdRate: "122.5",
  txnDate: "2026-10-02",
};

describe("a subscription is never a plain payment", () => {
  it("refuses the draft the owner was given, by its category", () => {
    const refusal = refusalOf(
      {
        target: "transaction_out",
        draft: {
          ...payment,
          description: "Claude Pro",
          categoryName: "AI tools",
        },
      },
      asked("claude pro kinlam 20 dollar", [
        { name: "AI tools", heading: "Technology" },
      ]),
    );

    expect(refusal?.part.key).toBe("subscriptions");
    expect(refusal?.say).toBe(
      "A subscription is recorded as a plan under AI tools and subscriptions, not as a plain payment. Is this a new plan, or the renewal of one already on file?",
    );
    // What the model is told, so it can answer again in the same turn.
    expect(refusal?.tell).toMatch(/Refused by the app/);
    expect(refusal?.tell).toMatch(/\[subscriptions\]/);
    expect(refusal?.tell).toMatch(/subscription or subscription_payment/);
  });

  it("refuses it by the heading the category sits under", () => {
    const refusal = refusalOf(
      {
        target: "transaction_out",
        draft: { ...payment, description: "Monthly", categoryName: "Cursor" },
      },
      asked("cursor er bill", [
        { name: "Cursor", heading: "Ai Tools and Subscriptions" },
      ]),
    );

    expect(refusal?.part.key).toBe("subscriptions");
  });

  it("refuses it by what the person typed, whatever category the model chose", () => {
    const refusal = refusalOf(
      {
        target: "transaction_out",
        draft: {
          ...payment,
          description: "Monthly payment",
          categoryName: "Office supplies",
        },
      },
      asked("ai subscription kinlam aaj, 20 dollar", [
        { name: "Office supplies", heading: "Office" },
      ]),
    );

    expect(refusal?.part.key).toBe("subscriptions");
  });

  it("refuses it by what the draft itself says", () => {
    const refusal = refusalOf(
      {
        target: "transaction_out",
        draft: {
          ...payment,
          description: "Notion subscription, October",
          categoryName: "Office supplies",
        },
      },
      asked("121.5"),
    );

    expect(refusal?.part.key).toBe("subscriptions");
  });

  it("refuses it by a short name that resolves only to a claimed category", () => {
    // "GPT" is looked up as the draft's check looks it up — by containment —
    // and every category it could be sits under the tooling heading.
    expect(
      refusalOf(
        {
          target: "transaction_out",
          draft: { ...payment, categoryName: "GPT" },
        },
        asked("gpt er bill dilam", [
          { name: "ChatGPT", heading: "Ai Tools and Subscriptions" },
        ]),
      )?.part.key,
    ).toBe("subscriptions");
    // A name that fits one claimed and one plain category is not claimed
    // yet: the draft's check asks which, and the answer is read again.
    expect(
      refusalOf(
        {
          target: "transaction_out",
          draft: { ...payment, categoryName: "Office" },
        },
        asked("office er bill", [
          { name: "Office software", heading: "Technology" },
          { name: "Office supplies", heading: "Office" },
        ]),
      ),
    ).toBeNull();
  });

  it("does not take a finished draft away over a word in the answer to it", () => {
    const draft = {
      ...payment,
      description: "Newspaper for the office",
      categoryName: "Office supplies",
    };
    const categories = [{ name: "Office supplies", heading: "Office" }];
    // Asked whether it is a subscription, the person says it is not.
    expect(
      refusalOf(
        { target: "transaction_out", draft },
        asked("na, eta subscription na", categories, "cfo", {
          draftOpen: true,
        }),
      ),
    ).toBeNull();
    // The same words opening a request are read.
    expect(
      refusalOf(
        { target: "transaction_out", draft },
        asked("newspaper subscription er bill", categories),
      )?.part.key,
    ).toBe("subscriptions");
  });

  it("says it differently the second time, with the way round it", () => {
    const again = refusalOf(
      {
        target: "transaction_out",
        draft: { ...payment, categoryName: "AI tools" },
      },
      asked("claude", [{ name: "AI tools", heading: "Technology" }], "cfo", {
        lastAnswer: BELONGS,
      }),
    );

    expect(again?.say).toMatch(/^I can record a subscription only as a plan/);
    expect(again?.say).toMatch(/ordinary form/);
  });

  it("refuses a tool drafted as a vendor, however its type is written", () => {
    for (const type of ["ai_tool", "AI Tool", "Hosting", "subscription"]) {
      expect([
        type,
        refusalOf(
          { target: "vendor", draft: { name: "OpenAI", type } },
          asked("openai add koro"),
        )?.part.key,
      ]).toEqual([type, "subscriptions"]);
    }
    // A supplier with a tax number is a vendor, and stays one.
    expect(
      refusalOf(
        {
          target: "vendor",
          draft: { name: "Sundarban Courier", type: "supplier" },
        },
        asked("sundarban courier ke vendor hisebe add koro"),
      ),
    ).toBeNull();
  });

  it("leaves a plain payment alone", () => {
    expect(
      refusalOf(
        {
          target: "transaction_out",
          draft: {
            ...payment,
            description: "DESCO bill, September",
            categoryName: "Electricity",
          },
        },
        asked("aaj electricity bill 3200 taka dilam", [
          { name: "Electricity", heading: "Utilities" },
        ]),
      ),
    ).toBeNull();
  });

  it("holds a file's import plan to the same, and says why a file cannot go", () => {
    const claimed = claimOn(
      "transaction_out",
      { categoryName: "Software & subscriptions" },
      asked("ei file ta import koro"),
    );
    expect(claimed?.part.claims?.sayOfAFile).toMatch(
      /Import takes plain entries only/,
    );
    expect(
      claimOn(
        "transaction_out",
        { categoryName: "Office supplies" },
        asked("ei file ta import koro", [
          { name: "Office supplies", heading: "Office" },
        ]),
      ),
    ).toBeNull();
  });

  it("never takes plans or renewals as a table of rows", () => {
    for (const target of ["subscription", "subscription_payment"] as const) {
      const refusal = tableRefusalOf(target);
      expect(refusal?.part.key).toBe("subscriptions");
      expect(refusal?.say).toMatch(/one at a time/);
      expect(refusal?.tell).toMatch(/never proposed in 'batch'/);
    }
    // Every other kind may come as a table.
    for (const target of [
      "transaction_out",
      "transaction_in",
      "transfer",
      "vendor",
      "team_member",
      "tds_deposit",
    ] as const) {
      expect([target, tableRefusalOf(target)]).toEqual([target, null]);
    }
  });

  it("leaves a plan and its renewal alone: those are the part's own", () => {
    for (const target of ["subscription", "subscription_payment"] as const) {
      expect(
        refusalOf(
          {
            area: "subscriptions",
            target,
            draft: { toolName: "Claude", description: "Claude subscription" },
          },
          asked("claude subscription renew korlam"),
        ),
      ).toBeNull();
    }
  });
});

describe("the part the model named has to keep what it drafted", () => {
  it("refuses a salary drafted as a payment, with Payroll's own sentence", () => {
    const refusal = refusalOf(
      {
        area: "payroll",
        target: "transaction_out",
        draft: { ...payment, description: "September salary" },
      },
      asked("september er salary dilam 5 lakh"),
    );

    expect(refusal?.part.key).toBe("payroll");
    expect(refusal?.say).toMatch(/I cannot record a salary payment/);
    expect(refusal?.tell).toMatch(/where you cannot draft anything/);
  });

  it("refuses a plain payment the model itself called a subscription", () => {
    // Nothing in the draft or in what was typed says so; the model did.
    const refusal = refusalOf(
      {
        area: "subscriptions",
        target: "transaction_out",
        draft: { ...payment, description: "Figma, October" },
      },
      asked("figma er taka dilam"),
    );

    expect(refusal?.part.key).toBe("subscriptions");
    expect(refusal?.say).toMatch(/^A subscription is recorded as a plan/);
    expect(refusal?.tell).toMatch(
      /keeps subscription and subscription_payment and never a transaction_out/,
    );
  });

  it("does not drop a sound draft over a slip in the part's name", () => {
    // A transfer filed under the ledger's name is still the transfer.
    const slip = {
      area: "transactions",
      target: "transfer" as const,
      draft: { amount: "500" },
    };
    expect(refusalOf(slip, asked("500 taka pathao"))).toBeNull();
    expect(areaOf(slip)).toBe("transfers");
    // And a plain payment called "transfers" is still a plain payment.
    expect(
      refusalOf(
        { area: "transfers", target: "transaction_out", draft: payment },
        asked("exprovia theke 500 taka"),
      ),
    ).toBeNull();
  });

  it("accepts a draft the named part keeps", () => {
    expect(
      refusalOf(
        { area: "transfers", target: "transfer", draft: { amount: "500" } },
        asked("500 taka pathao"),
      ),
    ).toBeNull();
    // Money coming in is the ledger's and Cash In's both.
    for (const area of ["transactions", "cash_in"]) {
      expect(
        refusalOf(
          { area, target: "transaction_in", draft: { amount: "500" } },
          asked("500 taka ashche"),
        ),
      ).toBeNull();
    }
  });

  it("has nothing to refuse when nothing was drafted", () => {
    expect(
      refusalOf(
        { area: "payroll", target: null, draft: {} },
        asked("salary sheet kothay?"),
      ),
    ).toBeNull();
  });
});

describe("a draft the person's role could not save is not offered", () => {
  it("refuses HR a payment, and says it is the role", () => {
    const refusal = refusalOf(
      { target: "transaction_out", draft: payment },
      asked("aaj 500 taka dilam", [], "hr"),
    );

    expect(refusal?.say).toMatch(/Your role cannot record money going out/);
    expect(refusal?.tell).toMatch(/transactions\.write/);
  });

  it("needs both of a new plan's permissions: the plan and its first payment", () => {
    expect(
      refusalOf(
        { target: "subscription", draft: { toolName: "Claude" } },
        asked("claude kinlam", [], "hr"),
      )?.tell,
    ).toMatch(/vendors\.write, transactions\.write/);
    expect(
      refusalOf(
        { target: "subscription", draft: { toolName: "Claude" } },
        asked("claude kinlam", [], "cfo"),
      ),
    ).toBeNull();
  });

  it("lets HR add somebody to the team, which HR may", () => {
    expect(
      refusalOf(
        { target: "team_member", draft: { fullName: "Rahim Uddin" } },
        asked("rahim ke team e add koro", [], "hr"),
      ),
    ).toBeNull();
  });

  it("refuses a role the app does not know", () => {
    expect(
      refusalOf(
        { target: "transfer", draft: {} },
        asked("pathao", [], "finance"),
      ),
    ).not.toBeNull();
  });
});

describe("the part an answer is reported under", () => {
  it("is the one the model named, when it keeps what was drafted", () => {
    expect(
      areaOf({ area: "cash_in", target: "transaction_in", draft: {} }),
    ).toBe("cash_in");
    expect(areaOf({ area: "payroll", target: null, draft: {} })).toBe(
      "payroll",
    );
  });

  it("is the draft's own home when none was named, or a wrong one", () => {
    expect(areaOf({ target: "transfer", draft: {} })).toBe("transfers");
    expect(areaOf({ area: "nowhere", target: "subscription", draft: {} })).toBe(
      "subscriptions",
    );
    expect(areaOf({ area: "payroll", target: "tds_deposit", draft: {} })).toBe(
      "tds",
    );
    expect(areaOf({ area: "nowhere", target: null, draft: {} })).toBeNull();
  });
});

describe("a plan on file that a plain payment names", () => {
  const plan = (toolName: string, planName: string, status = "active") => ({
    id: randomUUID(),
    toolName,
    planName,
    status,
  });
  const plans = [
    plan("Claude", "Max"),
    plan("Google", "Workspace Business"),
    plan("ChatGPT", "Plus"),
    plan("ChatGPT", "Team"),
    plan("Zoom", "Pro", "canceled"),
    plan("X", "Premium"),
  ];

  it("is found by the tool's name, as a whole word", () => {
    expect(planNamedIn(plans, ["claude er bill dilam 2450 taka"])).toBe(
      "Claude",
    );
    expect(planNamedIn(plans, ["", "Paid Google for October"])).toBe("Google");
  });

  it("is written with its plan where a tool has two", () => {
    expect(planNamedIn(plans, ["chatgpt er taka dilam"])).toBe(
      "ChatGPT › Plus",
    );
  });

  it("is not found inside another word, by a short name, or once cancelled", () => {
    expect(planNamedIn(plans, ["googled the courier's address"])).toBeNull();
    expect(planNamedIn(plans, ["tax x 2"])).toBeNull();
    expect(planNamedIn(plans, ["zoom er bill"])).toBeNull();
    expect(planNamedIn(plans, [undefined, 12, null])).toBeNull();
  });
});
