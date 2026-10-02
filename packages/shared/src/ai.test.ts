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
  AI_TARGETS,
  AI_TARGET_ENDPOINT,
  AI_TARGET_PERMISSION,
  aiModelFrom,
  aiModelGoesWith,
  aiModelProviderProblem,
  aiModelsFor,
  isGeminiModel,
  updateAiSettingsSchema,
  type AiModel,
} from "./ai.ts";

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
    assert.equal(aiModelProviderProblem("claude-opus-5", "vertex"), null);
  });

  it("says in words why a pair nothing could answer is refused", () => {
    for (const model of AI_MODELS.filter(isGeminiModel)) {
      assert.match(
        aiModelProviderProblem(model, "anthropic") ?? "",
        /is reached through Google Cloud, not through Anthropic key/,
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
  it("is itself, when it is offered and can be reached that way", () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of aiModelsFor(provider)) {
        assert.equal(aiModelFrom(model, provider), model);
      }
    }
  });

  it("is Claude when the row is empty, or names nothing known", () => {
    for (const provider of AI_PROVIDERS) {
      assert.equal(aiModelFrom(null, provider), "claude-opus-5");
      assert.equal(aiModelFrom(undefined, provider), "claude-opus-5");
      assert.equal(aiModelFrom("claude-haiku-4-5", provider), "claude-opus-5");
    }
  });

  it("is Claude for a Gemini on the Anthropic key, listed or not", () => {
    assert.equal(aiModelFrom("gemini-2.5-pro", "anthropic"), "claude-opus-5");
    assert.equal(aiModelFrom("gemini-1.5-pro", "anthropic"), "claude-opus-5");
  });

  it("is the Gemini offered first for a Gemini taken off the list, not Claude", () => {
    // What the live row will hold once 2.5 Pro is taken out of AI_MODELS.
    assert.equal(aiModelFrom("gemini-1.5-pro", "vertex"), AI_GEMINI_DEFAULT);
  });
});

describe("updateAiSettingsSchema", () => {
  it("takes a model and a provider that go together", () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of aiModelsFor(provider)) {
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
    assert.equal(AI_TARGET_PERMISSION.transfer, "transactions.write");
  });

  it("says under a ready draft that nothing is recorded yet", () => {
    assert.match(AI_DRAFT_READY_LINE, /press Save/);
    assert.match(AI_DRAFT_READY_LINE, /Nothing is recorded yet/);
  });
});
