import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AI_DRAFT_READY_LINE,
  AI_MODELS,
  AI_MODEL_PROVIDERS,
  AI_PROVIDERS,
  AI_TARGETS,
  AI_TARGET_ENDPOINT,
  AI_TARGET_PERMISSION,
  aiModelGoesWith,
  aiModelProviderProblem,
  aiModelsFor,
  isGeminiModel,
  updateAiSettingsSchema,
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
