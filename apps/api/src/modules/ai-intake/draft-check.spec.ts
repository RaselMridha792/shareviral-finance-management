/**
 * A draft is ready when the schema its Save uses accepts it — and not before,
 * whatever the model said (2 Oct 2026).
 *
 * The first case is the one the owner met on the live site: a transfer of a
 * lakh, drafted by Gemini as money going out, with no category and nothing
 * listed as missing. The rest are the rules that follow from checking in
 * code: names looked up rather than taken on trust, a transfer as a record of
 * its own, and no sentence that says "recorded" before anybody has saved.
 *
 * No database: what the books hold under a name is handed to the check.
 */
import { randomUUID } from "node:crypto";

import { AI_TARGETS, type AiTarget } from "@finance/shared";

import {
  askFor,
  categoryLabels,
  categoryMatches,
  checkDraft,
  claimsItIsDone,
  hasOwnQuestion,
  knowsField,
  nameOf,
  namesIn,
  tidyDraft,
  type NameMatches,
} from "./draft-check";
import {
  NOT_FOR_THE_MODEL,
  TARGET_SCHEMAS,
  fieldReferenceFor,
} from "./field-reference";

const EXPROVIA = { id: randomUUID(), name: "M/S. EXPROVIA", currency: "BDT" };
const NIZAM = { id: randomUUID(), name: "Md. Nizam Uddin", currency: "BDT" };
const NIZAM_BKASH = {
  id: randomUUID(),
  name: "Md. Nizam Uddin (bKash)",
  currency: "BDT",
};
const CARD = { id: randomUUID(), name: "Master card", currency: "USD" };
const RENT = { id: randomUUID(), name: "Office rent" };
const SUPPLIES = { id: randomUUID(), name: "Office supplies" };

const ACCOUNTS = [EXPROVIA.name, NIZAM.name, CARD.name];

/** The check, with the books answering for each name as `matches` says. */
function check(
  target: AiTarget,
  draft: Record<string, unknown>,
  matches: NameMatches = {},
) {
  const tidy = tidyDraft(draft);
  // Every name the check will look at is one the caller was asked to find.
  for (const { field } of namesIn(target, tidy)) {
    expect(Object.keys(matches)).toContain(field.name);
  }
  return checkDraft(target, tidy, matches, ACCOUNTS);
}

const fieldsOf = (checked: ReturnType<typeof check>) =>
  checked.problems.map((problem) => problem.field);

describe("the draft the owner was shown", () => {
  // As Gemini returned it: amounts as numbers, a counterparty, no category.
  const asDrafted = {
    amount: 100000,
    accountName: "M/S. EXPROVIA",
    counterparty: "Md. Nizam Uddin",
    usdRate: 121.5,
    txnDate: "2026-10-02",
    description: "Transfer to Md. Nizam Uddin",
  };

  it("is not ready: the category Save would refuse is asked for", () => {
    const checked = check("transaction_out", asDrafted, {
      accountName: [EXPROVIA],
    });

    expect(fieldsOf(checked)).toEqual(["categoryName"]);
    expect(checked.problems[0].question).toBe("Which category is this under?");
  });

  it("is ready once the category is one the books have", () => {
    const checked = check(
      "transaction_out",
      { ...asDrafted, categoryName: "office rent" },
      { accountName: [EXPROVIA], categoryName: [RENT] },
    );

    expect(checked.problems).toEqual([]);
    // Text, as the card's boxes hold it — and the name as the books spell it.
    expect(checked.draft).toMatchObject({
      amount: "100000",
      usdRate: "121.5",
      categoryName: "Office rent",
    });
  });

  it("is a transfer when both ends are ours, with no category to ask for", () => {
    const checked = check(
      "transfer",
      {
        amount: "100000",
        fromAccountName: "M/S. EXPROVIA",
        toAccountName: "Md. Nizam Uddin",
        usdRate: "121.5",
        txnDate: "2026-10-02",
        // Neither belongs on a transfer; a model that adds them is not obeyed.
        counterparty: "Md. Nizam Uddin",
        categoryName: "Office rent",
      },
      { fromAccountName: [EXPROVIA], toAccountName: [NIZAM] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).toEqual({
      amount: "100000",
      fromAccountName: "M/S. EXPROVIA",
      toAccountName: "Md. Nizam Uddin",
      usdRate: "121.5",
      txnDate: "2026-10-02",
      description: "Transfer from M/S. EXPROVIA to Md. Nizam Uddin",
    });
  });
});

describe("what a transfer needs", () => {
  const moved = {
    amount: "5000",
    txnDate: "2026-10-02",
    usdRate: "121.5",
    fromAccountName: "M/S. EXPROVIA",
  };

  it("asks for the rate: the transfer schema requires one on every entry", () => {
    const checked = check(
      "transfer",
      { ...moved, usdRate: undefined, toAccountName: "Md. Nizam Uddin" },
      { fromAccountName: [EXPROVIA], toAccountName: [NIZAM] },
    );

    expect(fieldsOf(checked)).toEqual(["usdRate"]);
    expect(checked.problems[0].question).toMatch(/USD rate/);
  });

  it("asks for the dollars when a dollar account is on either side", () => {
    const checked = check(
      "transfer",
      { ...moved, toAccountName: "Master card" },
      { fromAccountName: [EXPROVIA], toAccountName: [CARD] },
    );

    expect(fieldsOf(checked)).toEqual(["usdAmount"]);
    expect(checked.problems[0].question).toBe(
      "Master card is a dollar account. How many dollars moved?",
    );
  });

  it("keeps no dollars on a transfer between two taka accounts, as the form sends none", () => {
    const checked = check(
      "transfer",
      { ...moved, toAccountName: "Md. Nizam Uddin", usdAmount: "41.15" },
      { fromAccountName: [EXPROVIA], toAccountName: [NIZAM] },
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).not.toHaveProperty("usdAmount");
  });

  it("refuses the same account on both sides, and asks where it goes", () => {
    const checked = check(
      "transfer",
      { ...moved, toAccountName: "EXPROVIA" },
      { fromAccountName: [EXPROVIA], toAccountName: [EXPROVIA] },
    );

    expect(fieldsOf(checked)).toEqual(["toAccountName"]);
    expect(checked.draft.toAccountName).toBeUndefined();
    expect(checked.problems[0].question).toMatch(
      /^Both sides are M\/S\. EXPROVIA/,
    );
  });

  it("asks for each end before anything else", () => {
    const checked = check("transfer", { amount: "5000" });

    expect(fieldsOf(checked).slice(0, 2)).toEqual([
      "fromAccountName",
      "toAccountName",
    ]);
    expect(fieldsOf(checked)).toEqual(
      expect.arrayContaining(["txnDate", "usdRate"]),
    );
  });
});

describe("a name is looked up, not taken on trust", () => {
  const payment = {
    amount: "5000",
    txnDate: "2026-10-02",
    usdRate: "121.5",
    description: "Internet bill",
    categoryName: "Office rent",
  };

  it("lists the real choices when a name could be several accounts", () => {
    const checked = check(
      "transaction_out",
      { ...payment, accountName: "Nizam" },
      { accountName: [NIZAM, NIZAM_BKASH], categoryName: [RENT] },
    );

    expect(fieldsOf(checked)).toEqual(["accountName"]);
    // Not one of the two picked: the box is left empty and the two are named.
    expect(checked.draft.accountName).toBeUndefined();
    expect(checked.problems[0].question).toBe(
      '"Nizam" could be Md. Nizam Uddin or Md. Nizam Uddin (bKash). Which one?',
    );
  });

  it("says so when there is no such account, and names the ones there are", () => {
    const checked = check(
      "transaction_out",
      { ...payment, accountName: "City Bank" },
      { accountName: [], categoryName: [RENT] },
    );

    expect(fieldsOf(checked)).toEqual(["accountName"]);
    expect(checked.problems[0].question).toBe(
      'There is no account called "City Bank". Which account was it paid from? The accounts are M/S. EXPROVIA, Md. Nizam Uddin or Master card.',
    );
  });

  it("asks which category when the name fits several, or none", () => {
    const several = check(
      "transaction_out",
      { ...payment, accountName: "EXPROVIA", categoryName: "Office" },
      { accountName: [EXPROVIA], categoryName: [RENT, SUPPLIES] },
    );
    expect(several.problems[0].question).toBe(
      '"Office" could be Office rent or Office supplies. Which one?',
    );

    const none = check(
      "transaction_out",
      { ...payment, accountName: "EXPROVIA", categoryName: "Drone rental" },
      { accountName: [EXPROVIA], categoryName: [] },
    );
    expect(none.problems[0].question).toBe(
      'There is no money-out category called "Drone rental". Which category is this under?',
    );
  });

  it("takes a name out of an id's key, and drops an id the model wrote", () => {
    expect(
      tidyDraft({
        categoryId: "Office rent  —  money out",
        accountId: randomUUID(),
      }),
    ).toEqual({ categoryName: "Office rent" });
  });
});

describe("which category a name means", () => {
  const office = randomUUID();
  const equipment = randomUUID();
  const rows = [
    { id: office, name: "Office", parentId: null, parentName: null },
    { id: randomUUID(), name: "Rent", parentId: office, parentName: "Office" },
    {
      id: randomUUID(),
      name: "Rent",
      parentId: equipment,
      parentName: "Equipment",
    },
    { id: randomUUID(), name: "Office rent", parentId: null, parentName: null },
    {
      id: randomUUID(),
      name: "Office rent",
      parentId: office,
      parentName: "Office",
    },
  ];
  const named = (said: string) =>
    categoryMatches(
      rows.filter((row) =>
        row.name.toLowerCase().includes(
          said
            .split(/\s*[›>]\s*/)
            .pop()!
            .toLowerCase(),
        ),
      ),
      said,
    );

  it("prefers the sub-category to a heading of the same name", () => {
    expect(named("office rent")).toEqual([
      { id: rows[4].id, name: "Office rent" },
    ]);
  });

  it("tells two that share a name apart by their heading", () => {
    expect(named("Rent").map((match) => match.name)).toEqual([
      "Office › Rent",
      "Equipment › Rent",
    ]);

    const checked = check(
      "transaction_out",
      {
        amount: "5000",
        txnDate: "2026-10-02",
        usdRate: "121.5",
        description: "Rent",
        accountName: "EXPROVIA",
        categoryName: "Rent",
      },
      { accountName: [EXPROVIA], categoryName: named("Rent") },
    );
    // A question somebody can answer — not "Rent or Rent".
    expect(checked.problems[0].question).toBe(
      '"Rent" could be Office › Rent or Equipment › Rent. Which one?',
    );
  });

  it("reads the heading back, so the answer is the one and stays the one", () => {
    expect(named("Equipment › Rent")).toEqual([
      { id: rows[2].id, name: "Equipment › Rent" },
    ]);
    expect(named("office > rent")).toEqual([
      { id: rows[1].id, name: "Office › Rent" },
    ]);
  });

  it("writes the list the model is given the same way", () => {
    const labels = categoryLabels(rows.filter((row) => row.parentId !== null));
    expect([...labels.values()]).toEqual([
      "Office › Rent",
      "Equipment › Rent",
      "Office rent",
    ]);
  });
});

describe("what Save would refuse never reaches the card", () => {
  const payment = {
    amount: "5000",
    txnDate: "2026-10-02",
    usdRate: "121.5",
    description: "Internet bill",
    categoryName: "Office rent",
    accountName: "EXPROVIA",
  };
  const books = { accountName: [EXPROVIA], categoryName: [RENT] };

  it("drops a key the endpoint does not know", () => {
    const checked = check(
      "transaction_out",
      { ...payment, vendorName: "Link3", currencyCode: "BDT" },
      books,
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).not.toHaveProperty("vendorName");
    expect(checked.draft).not.toHaveProperty("currencyCode");
  });

  it("drops what is the app's to set, whichever way the model wrote it", () => {
    const checked = check(
      "transaction_out",
      { ...payment, direction: "in", createdVia: "manual", vendorId: "Link3" },
      books,
    );

    expect(checked.problems).toEqual([]);
    expect(Object.keys(checked.draft).sort()).toEqual(
      Object.keys(payment).sort(),
    );
  });

  it("asks again for a value the schema will not take, in the schema's words", () => {
    const checked = check(
      "transaction_out",
      { ...payment, usdRate: "121,5", txnDate: "02/10/2026" },
      books,
    );

    expect(fieldsOf(checked)).toEqual(["txnDate", "usdRate"]);
    expect(checked.draft).not.toHaveProperty("usdRate");
    expect(checked.problems[1].question).toBe(
      'USD rate "121,5" cannot be saved: Enter a rate like 122.77. What should it be?',
    );
  });

  it("reads a grouped figure as the figure, and nothing else as one", () => {
    expect(tidyDraft({ amount: "1,00,000" }).amount).toBe("100000");
    expect(tidyDraft({ amount: "৳ 4,500.50" }).amount).toBe("4500.50");
    expect(tidyDraft({ billAmount: 12500 }).billAmount).toBe("12500");
    // A decimal comma is not grouping: left as typed, to be refused.
    expect(tidyDraft({ usdRate: "121,5" }).usdRate).toBe("121,5");
    expect(tidyDraft({ amount: "4500,50" }).amount).toBe("4500,50");
  });

  it("keeps a dollar sign on a taka figure, so it is refused and asked about", () => {
    // "$100" in the amount is a hundred dollars, not a hundred taka.
    expect(tidyDraft({ amount: "$100" }).amount).toBe("$100");
    expect(
      tidyDraft({ usdAmount: "$100", originalAmount: "$ 1,250.00" }),
    ).toEqual({ usdAmount: "100", originalAmount: "1250.00" });

    const checked = check(
      "transaction_out",
      { ...payment, amount: "$100" },
      books,
    );
    expect(fieldsOf(checked)).toEqual(["amount"]);
    expect(checked.draft).not.toHaveProperty("amount");
  });

  it("asks for the foreign amount when only its rate was given, and keeps the rate", () => {
    const checked = check(
      "transaction_in",
      { ...payment, fxRate: "118.4" },
      books,
    );

    expect(fieldsOf(checked)).toEqual(["originalAmount"]);
    expect(checked.draft.fxRate).toBe("118.4");
    expect(checked.problems[0].question).toMatch(
      /^A rate of 118\.4 was given with no foreign amount/,
    );
  });

  it("does not take a good figure off for another figure's fault", () => {
    const checked = check(
      "transaction_out",
      {
        ...payment,
        amount: "4500,50",
        billAmount: "5000",
        withheldTaxAmount: "100",
      },
      books,
    );

    expect(fieldsOf(checked)).toEqual(["amount"]);
    expect(checked.draft).toMatchObject({
      billAmount: "5000",
      withheldTaxAmount: "100",
    });
  });

  it("says why, when it is a rule between two fields", () => {
    const checked = check(
      "transaction_in",
      { ...payment, originalAmount: "1000", originalCurrency: "USD" },
      books,
    );

    expect(fieldsOf(checked)).toEqual(["fxRate"]);
    expect(checked.problems[0].question).toBe(
      "A foreign amount needs the rate that converted it. What rate did the bank convert it at?",
    );
  });

  it("has no category to offer on a challan, so none is sent", () => {
    const checked = check(
      "tds_deposit",
      {
        challanNumber: "T-2291",
        challanDate: "2026-10-01",
        depositDate: "2026-10-01",
        amount: "12000",
        periodYear: 2026,
        periodMonth: 9,
        categoryName: "Office rent",
      },
      {},
    );

    expect(checked.problems).toEqual([]);
    expect(checked.draft).not.toHaveProperty("categoryName");
  });
});

describe("the questions", () => {
  it("has one written for every field a schema requires", () => {
    for (const target of AI_TARGETS) {
      const refused = TARGET_SCHEMAS[target].safeParse({});
      const required = refused.success
        ? []
        : refused.error.issues.map((issue) => String(issue.path[0]));

      for (const key of required) {
        // Set by the app itself, never asked of anybody.
        if (NOT_FOR_THE_MODEL.has(key) && nameOf(key) === key) continue;
        expect([target, nameOf(key), hasOwnQuestion(nameOf(key))]).toEqual([
          target,
          nameOf(key),
          true,
        ]);
      }
    }
  });

  it("asks about the account in the direction the money went", () => {
    expect(askFor("accountName", "transaction_out")).toBe(
      "Which account was it paid from?",
    );
    expect(askFor("accountName", "transaction_in")).toBe(
      "Which account did it come into?",
    );
  });

  it("knows which fields a record has, so a question can be answered", () => {
    expect(knowsField("transfer", "fromAccountName")).toBe(true);
    expect(knowsField("transfer", "categoryName")).toBe(false);
    expect(knowsField("transaction_out", "categoryName")).toBe(true);
    expect(knowsField("transaction_out", "vendorName")).toBe(false);
  });
});

describe("the field list the model is given", () => {
  it("marks the category REQUIRED on a payment, as the schema has it", () => {
    expect(fieldReferenceFor("transaction_out")).toMatch(
      /categoryName\s+REQUIRED/,
    );
  });

  it("gives a transfer its two accounts, and no category or single account", () => {
    const reference = fieldReferenceFor("transfer");

    expect(reference).toMatch(/fromAccountName\s+REQUIRED/);
    expect(reference).toMatch(/toAccountName\s+REQUIRED/);
    expect(reference).toMatch(/usdRate\s+REQUIRED/);
    expect(reference).not.toMatch(/categoryName|fromAccountId|toAccountId/);
    expect(reference).not.toMatch(/^\s+accountName/m);
  });

  it("offers no category on a challan", () => {
    expect(fieldReferenceFor("tds_deposit")).not.toMatch(/categoryName/);
  });
});

describe("a sentence that says it is done", () => {
  it("is caught in the first person, in any of the three ways people write", () => {
    for (const said of [
      "1 lakh taka transfer record korechi.",
      "Transfer ta kore diyechi.",
      "Entry save korlam, check kore nin.",
      "I have recorded the transfer.",
      "I’ve saved it for you.",
      "Recorded.",
      "Saved the transfer. Anything else?",
      "ট্রান্সফার রেকর্ড করেছি।",
      // য় typed as one character, and as য with a dot below.
      "ট্রান্সফার করে দিয়েছি।",
      "ট্রান্সফার করে দিয়েছি।",
    ]) {
      expect([said, claimsItIsDone(said, false)]).toEqual([said, true]);
    }
  });

  it("is caught said of the thing itself, while a draft is open", () => {
    for (const said of [
      "The transfer has been recorded.",
      "Transfer successfully completed.",
      "Entry save hoye geche.",
      "Done.",
      "এন্ট্রি সেভ হয়েছে।",
      "এন্ট্রি সেভ হয়েছে।",
    ]) {
      expect([said, claimsItIsDone(said, true)]).toEqual([said, true]);
    }
  });

  it("leaves a question, and an answer about the books, alone", () => {
    for (const said of [
      "EXPROVIA theke 1 lakh, Nizam Uddin e — aajker USD rate koto?",
      "Kon category te record korbo?",
      "Which account was it paid from?",
    ]) {
      expect([said, claimsItIsDone(said, true)]).toEqual([said, false]);
    }
    // True of the books, and no claim of the assistant's own.
    for (const said of [
      "August e 3 ta transfer record kora hoyeche, total ৳1,50,000.",
      "Three transfers were recorded in August.",
      "M/S. EXPROVIA te ekhon ৳4,99,800 ache.",
      // What it is asked to report beside a batch.
      "3 rows were already recorded in the books, so I left them out.",
      "Transferred amounts in August come to ৳1,50,000.",
    ]) {
      expect([said, claimsItIsDone(said, false)]).toEqual([said, false]);
    }
  });
});
