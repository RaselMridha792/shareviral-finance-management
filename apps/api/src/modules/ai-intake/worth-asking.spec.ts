/**
 * Every field asked at once (4 Oct 2026).
 *
 * The owner had the Assistant buy a Claude plan, and its row then read
 * "N/A" for Invoice, Reference, Login accounts, User name and User
 * department: nobody had been asked about them. "Sobgula field somporke
 * ekebarei jigges kore ney." These hold the list to what the brief asks:
 * Save's fields first, then what the page shows; "skip" leaves one empty on
 * purpose and it is not asked again; a choice between real names on its own.
 *
 * No database: what the books hold under each name is handed to the check.
 */
import { randomUUID } from "node:crypto";

import type { AiTarget } from "@finance/shared";

import { worthAskingFor } from "./app-map";
import {
  askFor,
  checkDraft,
  fieldLabel,
  namesListed,
  tidyDraft,
  type NameMatches,
  type PeopleMatches,
} from "./draft-check";
import {
  SKIP_LINE,
  askingLines,
  openFieldsOf,
  skipsAll,
  stillAsked,
} from "./worth-asking";

const EXPROVIA = { id: randomUUID(), name: "M/S. EXPROVIA", currency: "BDT" };
const RASEL = { id: randomUUID(), name: "Rasel Mridha" };
const RASEL_A = { id: randomUUID(), name: "Rasel Ahmed" };
const NIZAM = { id: randomUUID(), name: "Nizam Uddin" };

/** A new plan with everything Save needs. */
const PLAN = {
  toolName: "Claude",
  planName: "Max",
  category: "ai_tool",
  costUsd: "100.00",
  usdRate: "122.50",
  startDate: "2026-10-04",
  accountName: EXPROVIA.name,
};

function open(
  target: AiTarget,
  draft: Record<string, unknown>,
  {
    matches = {},
    people = {},
    skipped = [],
    invoiceGiven = false,
  }: {
    matches?: NameMatches;
    people?: PeopleMatches;
    skipped?: string[];
    invoiceGiven?: boolean;
  } = {},
) {
  const checked = checkDraft(
    target,
    tidyDraft(draft),
    matches,
    [EXPROVIA.name],
    [],
    people,
  );
  const fields = openFieldsOf({
    target,
    draft: checked.draft,
    problems: checked.problems,
    missing: checked.problems.map((problem) => problem.field),
    worth: worthAskingFor(target),
    skipped: new Set(skipped),
    invoiceGiven,
    labelOf: fieldLabel,
    askFor: (field) => askFor(field, target),
  });
  return { checked, fields };
}

const ACCOUNT = { accountName: [EXPROVIA] };

describe("a new plan asks about every column its row shows", () => {
  it("lists the owner's five, by the page's own headings, once Save has what it needs", () => {
    const { checked, fields } = open("subscription", PLAN, {
      matches: ACCOUNT,
    });
    expect(checked.problems).toEqual([]);
    expect(fields.map((field) => [field.label, field.required])).toEqual([
      ["Login accounts", false],
      ["User Name", false],
      ["User Department", false],
      ["Invoice", false],
      ["Reference", false],
    ]);
    // The invoice is a file; its number is asked only once it is attached
    // and could not be read off it.
    expect(fields.find((field) => field.field === "invoice")?.file).toBe(true);
    expect(fields.some((field) => field.field === "invoiceNo")).toBe(false);
  });

  it("puts what Save still needs first, then what is worth asking", () => {
    const { fields } = open("subscription", { toolName: "Claude" });
    const required = fields.filter((field) => field.required);
    const firstOptional = fields.findIndex((field) => !field.required);
    expect(required.map((field) => field.field)).toEqual(
      expect.arrayContaining([
        "planName",
        "costUsd",
        "startDate",
        "accountName",
        "usdRate",
      ]),
    );
    expect(firstOptional).toBe(required.length);
    expect(fields.slice(firstOptional).every((field) => !field.required)).toBe(
      true,
    );
  });

  it("asks nothing it was told", () => {
    const { fields } = open(
      "subscription",
      {
        ...PLAN,
        loginEmail: "ops@shareviral.cash",
        boughtFor: "Engineering",
        reference: "CARD-7781",
        userNames: "Rasel Mridha",
      },
      {
        matches: ACCOUNT,
        people: { "rasel mridha": [RASEL] },
        invoiceGiven: true,
      },
    );
    // Only the invoice's number is left: attached, and not read off it.
    expect(fields.map((field) => field.field)).toEqual(["invoiceNo"]);
  });

  it("marks a skipped field and stops asking it, but still shows it on the card", () => {
    const { fields } = open("subscription", PLAN, {
      matches: ACCOUNT,
      skipped: ["boughtFor", "invoice"],
    });
    expect(
      fields
        .filter((field) => field.skipped)
        .map((field) => field.field)
        .sort(),
    ).toEqual(["boughtFor", "invoice"]);
    expect(stillAsked(fields).map((field) => field.field)).toEqual([
      "loginEmail",
      "userNames",
      "reference",
    ]);
  });

  it("never makes a worth-asking field one Save needs, even when its value was refused", () => {
    const { checked, fields } = open(
      "subscription",
      { ...PLAN, userNames: "Somebody Else" },
      { matches: ACCOUNT, people: { "somebody else": [] } },
    );
    expect(checked.problems.map((problem) => problem.field)).toEqual([
      "userNames",
    ]);
    const users = fields.find((field) => field.field === "userNames");
    expect(users?.required).toBe(false);
    expect(users?.ask).toMatch(/nobody on Team called "Somebody Else"/);
  });
});

describe("who is on a plan, by name", () => {
  it("finds each on Team and saves them as the plan's users", () => {
    const { checked } = open(
      "subscription",
      { ...PLAN, userNames: ["Rasel Mridha", "nizam"] },
      {
        matches: ACCOUNT,
        people: { "rasel mridha": [RASEL], nizam: [NIZAM] },
      },
    );
    expect(checked.problems).toEqual([]);
    expect(checked.draft.userNames).toBe("Rasel Mridha, Nizam Uddin");
    expect(checked.body.users).toEqual([
      { teamMemberId: RASEL.id },
      { teamMemberId: NIZAM.id },
    ]);
    expect(checked.body).not.toHaveProperty("userNames");
  });

  it("asks which one when a name is two people's, on its own", () => {
    const { checked } = open(
      "subscription",
      { ...PLAN, userNames: "Rasel" },
      { matches: ACCOUNT, people: { rasel: [RASEL, RASEL_A] } },
    );
    expect(checked.problems).toEqual([
      {
        field: "userNames",
        question: '"Rasel" could be Rasel Mridha or Rasel Ahmed. Which one?',
        choice: true,
      },
    ]);
    expect(checked.body).not.toHaveProperty("users");
  });

  it("reads a list said in Bangla as well as in English", () => {
    expect(namesListed("Rasel o Nizam ar Tania")).toEqual([
      "Rasel",
      "Nizam",
      "Tania",
    ]);
    expect(namesListed("Rasel, Nizam and Rasel")).toEqual(["Rasel", "Nizam"]);
  });

  it("is no field of any other record", () => {
    const { checked } = open("transaction_out", {
      amount: "500",
      userNames: "Rasel",
    });
    expect(checked.draft).not.toHaveProperty("userNames");
  });
});

describe("a choice between real names is asked on its own", () => {
  it("marks two accounts called alike as a choice", () => {
    const other = { id: randomUUID(), name: "M/S. EXPROVIA USD" };
    const { checked } = open(
      "subscription",
      { ...PLAN, accountName: "EXPROVIA" },
      { matches: { accountName: [EXPROVIA, other] } },
    );
    expect(checked.problems.find((p) => p.field === "accountName")).toEqual(
      expect.objectContaining({ choice: true }),
    );
  });

  it("marks a renewal of a plan not on file as one: renewal or new plan", () => {
    const { checked } = open(
      "subscription_payment",
      { subscriptionName: "Zylofone Pro", txnDate: "2026-10-04" },
      { matches: { subscriptionName: [] } },
    );
    expect(
      checked.problems.find((p) => p.field === "subscriptionName"),
    ).toEqual(expect.objectContaining({ choice: true }));
  });

  it("does not mark a plain absence as one", () => {
    const { checked } = open("subscription", { toolName: "Claude" });
    expect(checked.problems.some((problem) => problem.choice)).toBe(false);
  });
});

describe("the other forms the Assistant drafts", () => {
  it("asks a payment, a receipt and a transfer for the ledger's Invoice and Reference", () => {
    for (const target of [
      "transaction_out",
      "transaction_in",
      "transfer",
    ] as const) {
      expect([
        target,
        worthAskingFor(target).map((one) => [one.field, one.shows]),
      ]).toEqual([
        target,
        [
          ["invoiceNo", "Invoice"],
          ["reference", "Reference"],
        ],
      ]);
    }
  });

  it("asks a new person for the four columns Team shows", () => {
    expect(worthAskingFor("team_member").map((one) => one.shows)).toEqual([
      "Employee ID",
      "Designation",
      "Employment type",
      "Department",
    ]);
  });

  it("asks nothing more of a renewal, a vendor or a challan, whose pages show none", () => {
    for (const target of [
      "subscription_payment",
      "vendor",
      "tds_deposit",
    ] as const) {
      expect([target, worthAskingFor(target)]).toEqual([target, []]);
    }
  });
});

describe("the list, as the chat says it", () => {
  it("is a line a field and tells them how to answer", () => {
    const text = askingLines([
      {
        field: "loginEmail",
        label: "Login accounts",
        ask: "the email",
        required: false,
      },
      {
        field: "usdRate",
        label: "USD rate",
        ask: "What rate?",
        required: true,
      },
    ]);
    expect(text.split("\n")).toEqual([
      "• Login accounts — the email",
      "• USD rate — What rate?",
      "",
      `Answer them all in one message. ${SKIP_LINE}`,
    ]);
  });

  it("does not offer skip when only what Save needs is asked", () => {
    expect(
      askingLines([
        {
          field: "usdRate",
          label: "USD rate",
          ask: "What rate?",
          required: true,
        },
      ]),
    ).not.toContain("skip");
  });
});

describe('"skip" as the whole answer', () => {
  it.each([
    "skip",
    "Skip.",
    "nai",
    "baki gula skip",
    "sob skip",
    "lagbe na",
    "skip all",
    "dorkar nai",
  ])("reads %j as leaving the rest empty", (text) => {
    expect(skipsAll(text)).toBe(true);
  });

  it.each([
    "na",
    "no",
    "invoice nai, login ops@shareviral.cash",
    "Rasel",
    "skip the invoice, reference is CARD-7781",
  ])("does not read %j as that", (text) => {
    expect(skipsAll(text)).toBe(false);
  });
});
