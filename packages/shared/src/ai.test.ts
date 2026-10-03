import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_DRAFT_READY_LINE,
  AI_GEMINI_DEFAULT,
  AI_MODELS,
  AI_MODEL_DETAIL,
  AI_MODEL_LABELS,
  AI_MODEL_PROVIDERS,
  AI_MODEL_RETIRING,
  AI_PROVIDERS,
  AI_FIRST_PAYMENT_NOTE,
  AI_INSTRUCTIONS_MAX,
  AI_MAX_ATTACHMENTS,
  AI_TARGETS,
  AI_TARGET_ENDPOINT,
  AI_TARGET_LABELS,
  AI_TARGET_PERMISSION,
  AI_TARGET_SHOWS_ON,
  aiConfirmSchema,
  aiIntakeRequestSchema,
  aiModelFrom,
  aiModelGoesWith,
  aiModelsFor,
  aiModelsOpen,
  aiRouteFor,
  findGoogleLinks,
  isDocAttachment,
  isGeminiModel,
  setAiInstructionsSchema,
  updateAiSettingsSchema,
  type AiModel,
} from "./ai.ts";
import { PERMISSIONS } from "./permissions.ts";

describe("which model goes which way", () => {
  it("offers every model through at least one provider", () => {
    for (const model of AI_MODELS) {
      assert.ok(AI_MODEL_PROVIDERS[model].length > 0, model);
    }
  });

  it("leaves no provider without a model to offer", () => {
    for (const provider of AI_PROVIDERS) {
      assert.ok(aiModelsFor(provider).length > 0, provider);
    }
  });

  it("offers Gemini through Google Cloud and never with an Anthropic key", () => {
    const gemini = AI_MODELS.filter(isGeminiModel);
    for (const model of gemini) {
      assert.equal(aiModelGoesWith(model, "vertex"), true);
      assert.equal(aiModelGoesWith(model, "anthropic"), false);
    }
    assert.deepEqual(aiModelsFor("anthropic").filter(isGeminiModel), []);
  });

  it("offers Claude either way", () => {
    assert.equal(aiModelGoesWith("claude-opus-5", "anthropic"), true);
    assert.equal(aiModelGoesWith("claude-opus-5", "vertex"), true);
  });
});

describe("the route follows the model (B2)", () => {
  it("sends Gemini through Google Cloud, whichever way Claude is set to go", () => {
    for (const model of AI_MODELS.filter(isGeminiModel)) {
      for (const claudeRoute of AI_PROVIDERS) {
        assert.equal(aiRouteFor(model, claudeRoute), "vertex", model);
      }
    }
  });

  it("sends Claude the way the settings say", () => {
    for (const claudeRoute of AI_PROVIDERS) {
      assert.equal(aiRouteFor("claude-opus-5", claudeRoute), claudeRoute);
    }
  });

  it("never sends a model a way it cannot go", () => {
    for (const model of AI_MODELS) {
      for (const claudeRoute of AI_PROVIDERS) {
        assert.ok(aiModelGoesWith(model, aiRouteFor(model, claudeRoute)));
      }
    }
  });

  it("offers in the chat every model whose route has its key, in order", () => {
    const gemini = AI_MODELS.filter(isGeminiModel);
    const both = { anthropic: true, google: true };
    assert.deepEqual(aiModelsOpen("anthropic", both), [...AI_MODELS]);
    assert.deepEqual(aiModelsOpen("vertex", both), [...AI_MODELS]);
    // The Anthropic key alone: Claude, and no Gemini.
    assert.deepEqual(
      aiModelsOpen("anthropic", { anthropic: true, google: false }),
      ["claude-opus-5"],
    );
    // The Google key alone, Claude set to the Anthropic key: Gemini only.
    assert.deepEqual(
      aiModelsOpen("anthropic", { anthropic: false, google: true }),
      gemini,
    );
    // Claude through Google Cloud needs no Anthropic key, only Google's.
    assert.deepEqual(
      aiModelsOpen("vertex", { anthropic: false, google: true }),
      [...AI_MODELS],
    );
    assert.deepEqual(
      aiModelsOpen("vertex", { anthropic: true, google: false }),
      [],
    );
    for (const claudeRoute of AI_PROVIDERS) {
      assert.deepEqual(
        aiModelsOpen(claudeRoute, { anthropic: false, google: false }),
        [],
      );
    }
  });
});

describe("which Gemini is offered", () => {
  it("offers the two Google lists as its latest, the one that is not a preview first", () => {
    assert.deepEqual(aiModelsFor("vertex").filter(isGeminiModel), [
      "gemini-3.8-flash",
      "gemini-3.1-pro-preview",
      "gemini-2.5-pro",
    ]);
    assert.equal(AI_GEMINI_DEFAULT, AI_MODELS.filter(isGeminiModel)[0]);
    assert.doesNotMatch(AI_GEMINI_DEFAULT, /preview/);
  });

  it("says on the picker which one is a preview and which one is going", () => {
    assert.match(AI_MODEL_DETAIL["gemini-3.1-pro-preview"], /A preview/);
    assert.match(
      AI_MODEL_DETAIL["gemini-2.5-pro"],
      /retires this model between 16 and 20 October 2026/,
    );
    for (const model of AI_MODELS.filter(isGeminiModel)) {
      assert.match(AI_MODEL_DETAIL[model], /On trial/, model);
    }
  });

  it("names a successor that is offered and is not going itself", () => {
    for (const [model, { successor }] of Object.entries(AI_MODEL_RETIRING)) {
      assert.ok(AI_MODELS.includes(successor), model);
      assert.equal(successor in AI_MODEL_RETIRING, false, model);
      assert.match(AI_MODEL_DETAIL[model as AiModel], /Choose /, model);
      assert.ok(
        AI_MODEL_DETAIL[model as AiModel].includes(AI_MODEL_LABELS[successor]),
        model,
      );
    }
  });
});

describe("what a stored model is read as", () => {
  it("is itself, when it is offered", () => {
    for (const model of AI_MODELS) assert.equal(aiModelFrom(model), model);
  });

  it("is nothing when the row is empty, or names nothing known", () => {
    // For a chat: the default. For the settings: the model offered first.
    assert.equal(aiModelFrom(null), null);
    assert.equal(aiModelFrom(undefined), null);
    assert.equal(aiModelFrom(""), null);
    assert.equal(aiModelFrom("claude-haiku-4-5"), null);
  });

  it("is the Gemini offered first for a Gemini taken off the list, not Claude", () => {
    // What a row will hold once 2.5 Pro is taken out of AI_MODELS.
    assert.equal(aiModelFrom("gemini-1.5-pro"), AI_GEMINI_DEFAULT);
  });
});

describe("updateAiSettingsSchema", () => {
  it("takes any default model with either route for Claude (B2)", () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of AI_MODELS) {
        assert.equal(
          updateAiSettingsSchema.safeParse({ model, provider }).success,
          true,
          `${model} / ${provider}`,
        );
      }
    }
  });

  it("takes either one alone: the service holds it against the stored other", () => {
    assert.equal(
      updateAiSettingsSchema.safeParse({ provider: "anthropic" }).success,
      true,
    );
    for (const model of AI_MODELS) {
      assert.equal(updateAiSettingsSchema.safeParse({ model }).success, true);
    }
  });

  it("still refuses an empty change", () => {
    assert.equal(updateAiSettingsSchema.safeParse({}).success, false);
  });
});

describe("what the assistant can draft", () => {
  it("drafts a transfer between our own accounts, for the transfer form's endpoint", () => {
    assert.ok(AI_TARGETS.includes("transfer"));
    assert.equal(AI_TARGET_ENDPOINT.transfer, "/transactions/transfer");
    // The same permission the Money Transfer form's endpoint asks for.
    assert.deepEqual(AI_TARGET_PERMISSION.transfer, ["transactions.write"]);
  });

  it("drafts a plan and its renewal, for the subscriptions form's own endpoints", () => {
    assert.ok(AI_TARGETS.includes("subscription"));
    assert.ok(AI_TARGETS.includes("subscription_payment"));
    assert.equal(AI_TARGET_ENDPOINT.subscription, "/subscriptions");
    assert.equal(
      AI_TARGET_ENDPOINT.subscription_payment,
      "/subscriptions/:id/pay",
    );
    // A new plan takes its first payment, so it needs both; a renewal is a
    // ledger entry, as the Renew drawer's endpoint has it.
    assert.deepEqual(AI_TARGET_PERMISSION.subscription, [
      "vendors.write",
      "transactions.write",
    ]);
    assert.deepEqual(AI_TARGET_PERMISSION.subscription_payment, [
      "transactions.write",
    ]);
  });

  it("names every kind in each table, and only permissions that exist", () => {
    for (const target of AI_TARGETS) {
      assert.ok(AI_TARGET_LABELS[target], target);
      assert.ok(AI_TARGET_ENDPOINT[target].startsWith("/"), target);
      assert.ok(AI_TARGET_PERMISSION[target].length > 0, target);
      for (const permission of AI_TARGET_PERMISSION[target]) {
        assert.ok(PERMISSIONS.includes(permission), `${target}: ${permission}`);
      }
      assert.ok(target in AI_TARGET_SHOWS_ON, target);
      // Stored on a correction as varchar(32).
      assert.ok(target.length <= 32, target);
    }
  });

  it("says where a saved plan shows: the page the owner looked for it on", () => {
    assert.deepEqual(AI_TARGET_SHOWS_ON.subscription, {
      name: "AI tools and subscriptions",
      href: "/subscriptions",
    });
    assert.equal(
      AI_TARGET_SHOWS_ON.subscription_payment?.href,
      "/subscriptions",
    );
    // No screen lists vendors today.
    assert.equal(AI_TARGET_SHOWS_ON.vendor, null);
    // The TDS screen lists no challans; a challan's payment is a ledger row.
    assert.equal(AI_TARGET_SHOWS_ON.tds_deposit?.href, "/transactions");
    assert.match(AI_FIRST_PAYMENT_NOTE, /First payment/);
  });

  it("says under a ready draft that nothing is recorded yet", () => {
    // The button's own words (A4).
    assert.match(AI_DRAFT_READY_LINE, /press Confirm and save/);
    assert.match(AI_DRAFT_READY_LINE, /Nothing is recorded yet/);
  });
});

describe("Confirm and save (A4)", () => {
  const chatId = "7d3f9a52-1c4b-4e8a-9f0d-2b6c8e1a4f30";

  it("takes the card's values, every one as text", () => {
    const parsed = aiConfirmSchema.parse({
      chatId,
      draft: { amount: "4500", accountName: "City Bank" },
    });
    assert.deepEqual(parsed.draft, {
      amount: "4500",
      accountName: "City Bank",
    });
  });

  it("takes a row of the table by its number", () => {
    assert.equal(aiConfirmSchema.parse({ chatId, row: 0 }).row, 0);
    assert.equal(aiConfirmSchema.parse({ chatId, row: 99 }).row, 99);
  });

  it("refuses both at once, neither, and a row past the table's limit", () => {
    assert.equal(
      aiConfirmSchema.safeParse({ chatId, row: 0, draft: {} }).success,
      false,
    );
    assert.equal(aiConfirmSchema.safeParse({ chatId }).success, false);
    assert.equal(
      aiConfirmSchema.safeParse({ chatId, row: 100 }).success,
      false,
    );
    assert.equal(aiConfirmSchema.safeParse({ chatId, row: -1 }).success, false);
  });

  it("never takes the kind of record from the caller", () => {
    // Read from the conversation on the server: an extra key is refused.
    assert.equal(
      aiConfirmSchema.safeParse({ chatId, draft: {}, target: "vendor" })
        .success,
      false,
    );
    // Nor a value that is not text, as a number the card never sends.
    assert.equal(
      aiConfirmSchema.safeParse({ chatId, draft: { amount: 4500 } }).success,
      false,
    );
  });

  it("refuses a conversation that is not an id", () => {
    assert.equal(
      aiConfirmSchema.safeParse({ chatId: "chat-1", row: 0 }).success,
      false,
    );
  });
});

describe("the owner's instructions for the assistant", () => {
  it("takes plain text, one line ending whichever machine typed it", () => {
    const parsed = setAiInstructionsSchema.parse({
      instructions:
        "  Claude kena = AI tools\r\nHosting = subscription\rDomain = subscription  ",
    });
    assert.equal(
      parsed.instructions,
      "Claude kena = AI tools\nHosting = subscription\nDomain = subscription",
    );
  });

  it("takes an empty text: no rules is a real answer", () => {
    assert.equal(
      setAiInstructionsSchema.parse({ instructions: "   " }).instructions,
      "",
    );
  });

  it("refuses a text over the limit, and says the limit", () => {
    const over = setAiInstructionsSchema.safeParse({
      instructions: "a".repeat(AI_INSTRUCTIONS_MAX + 1),
    });
    assert.equal(over.success, false);
    assert.match(over.error?.issues[0]?.message ?? "", /4,000 characters/);
    assert.equal(
      setAiInstructionsSchema.safeParse({
        instructions: "a".repeat(AI_INSTRUCTIONS_MAX),
      }).success,
      true,
    );
  });

  it("refuses anything but the text", () => {
    assert.equal(
      setAiInstructionsSchema.safeParse({ instructions: "x", model: "y" })
        .success,
      false,
    );
    assert.equal(setAiInstructionsSchema.safeParse({}).success, false);
  });
});

describe("findGoogleLinks — a link pasted into the chat (A3)", () => {
  const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
  const FILE = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765";

  it("reads a sheet, with the tab its link names", () => {
    const [link] = findGoogleLinks(
      `ei sheet ta dekho https://docs.google.com/spreadsheets/d/${SHEET}/edit?gid=0#gid=1834620192`,
    );
    assert.equal(link?.kind, "sheet");
    assert.equal(link?.id, SHEET);
    assert.equal(link?.gid, "1834620192");
  });

  it("reads a doc, and a sheet opened from a second Google account", () => {
    const [doc] = findGoogleLinks(
      `https://docs.google.com/document/d/${SHEET}/edit?tab=t.0`,
    );
    assert.deepEqual(
      { kind: doc?.kind, id: doc?.id, gid: doc?.gid },
      { kind: "doc", id: SHEET, gid: undefined },
    );
    const [other] = findGoogleLinks(
      `https://docs.google.com/spreadsheets/u/1/d/${SHEET}/edit`,
    );
    assert.equal(other?.kind, "sheet");
    assert.equal(other?.id, SHEET);
  });

  it("reads every form of a Drive file's link", () => {
    for (const url of [
      `https://drive.google.com/file/d/${FILE}/view?usp=sharing`,
      `https://drive.google.com/file/u/0/d/${FILE}/view`,
      `https://drive.google.com/open?id=${FILE}`,
      `https://drive.google.com/uc?id=${FILE}&export=download`,
      `https://docs.google.com/uc?id=${FILE}`,
    ]) {
      const [link] = findGoogleLinks(url);
      assert.equal(link?.kind, "file", url);
      assert.equal(link?.id, FILE, url);
    }
  });

  it("names a folder, and what it cannot read, rather than ignoring them", () => {
    const [folder] = findGoogleLinks(
      `https://drive.google.com/drive/u/0/folders/${FILE}`,
    );
    assert.equal(folder?.kind, "folder");
    assert.equal(folder?.id, FILE);
    for (const url of [
      `https://docs.google.com/presentation/d/${SHEET}/edit`,
      `https://docs.google.com/forms/d/${SHEET}/viewform`,
      // A published copy: its id is not the file's.
      `https://docs.google.com/spreadsheets/d/e/2PACX-${SHEET}/pubhtml`,
    ]) {
      const [link] = findGoogleLinks(url);
      assert.equal(link?.kind, "other", url);
      assert.equal(link?.id, null, url);
    }
  });

  it("leaves a sentence's own punctuation off the link", () => {
    const [link] = findGoogleLinks(
      `Read (https://drive.google.com/file/d/${FILE}/view). Thanks`,
    );
    assert.equal(link?.url, `https://drive.google.com/file/d/${FILE}/view`);
  });

  it("counts one file once, and two files twice", () => {
    assert.equal(
      findGoogleLinks(
        `https://docs.google.com/spreadsheets/d/${SHEET}/edit and again https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`,
      ).length,
      1,
    );
    assert.equal(
      findGoogleLinks(
        `https://docs.google.com/spreadsheets/d/${SHEET}/edit https://drive.google.com/file/d/${FILE}/view`,
      ).length,
      2,
    );
  });

  it("finds nothing in a message with no Google link", () => {
    assert.deepEqual(
      findGoogleLinks("netflix 1200 taka, https://example.com/a"),
      [],
    );
    assert.deepEqual(findGoogleLinks("google.com/spreadsheets"), []);
  });

  it("tells a Doc from an uploaded file by its name", () => {
    assert.equal(isDocAttachment("Board notes.gdoc"), true);
    assert.equal(isDocAttachment("statement.csv"), false);
  });
});

describe("the files a turn reads (A3b)", () => {
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const turn = (extra: Record<string, unknown>) =>
    aiIntakeRequestSchema.safeParse({
      messages: [{ role: "user", content: "ei sheet e koto?" }],
      ...extra,
    });

  it("takes every tab of a Sheet, up to the most one turn reads", () => {
    const tabs = Array.from({ length: AI_MAX_ATTACHMENTS }, (_, n) => id(n));
    assert.equal(turn({ attachmentIds: tabs }).success, true);
    assert.equal(turn({ attachmentIds: [...tabs, id(99)] }).success, false);
    assert.equal(turn({ attachmentIds: [] }).success, false);
    assert.equal(turn({ attachmentIds: ["not-an-id"] }).success, false);
  });

  it("still takes the one file a page loaded before A3b sends", () => {
    assert.equal(turn({ attachmentId: id(1) }).success, true);
  });
});

describe("the model a turn carries (B2)", () => {
  const turn = (extra: Record<string, unknown>) =>
    aiIntakeRequestSchema.safeParse({
      messages: [{ role: "user", content: "courier ke 500 taka dilam" }],
      ...extra,
    });

  it("takes any model offered, or none (the default)", () => {
    for (const model of AI_MODELS) {
      assert.equal(turn({ model }).success, true, model);
    }
    assert.equal(turn({}).success, true);
  });

  it("refuses a model nobody offers", () => {
    assert.equal(turn({ model: "gemini-9-ultra" }).success, false);
    assert.equal(turn({ model: "" }).success, false);
  });
});
