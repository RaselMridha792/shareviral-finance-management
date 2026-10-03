import type Anthropic from "@anthropic-ai/sdk";
import type { AiMessage } from "@finance/shared";

import type { ClaudeClient } from "./claude-errors";

/**
 * One turn, whichever model answers it (2 Oct 2026).
 *
 * Everything that is about the books is the same for Claude and for Gemini:
 * the prompts, the tool definitions, `normalise`, the corrections, the
 * attachments. What differs is only how a request is put to the model and how
 * its tool calls come back — so that, and nothing else, is behind this
 * interface. `claudeModel` is below; `geminiModel` is in gemini.ts.
 */

/** A tool as this app writes them: a name, what it is for, a JSON schema. */
export type ModelTool = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool["input_schema"];
};

export type ModelCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ModelCallResult = {
  call: ModelCall;
  /** Rendered for the model to read. */
  text: string;
  ok: boolean;
};

export type TurnRequest = {
  /** Identical on every turn of every conversation: the half worth caching. */
  stablePrompt: string;
  /** What is different this turn. Always after the stable half. */
  turnPrompt: string;
  /** What has been said, opening on the person. */
  messages: AiMessage[];
  tools: ModelTool[];
  /** Room for the reply. A model that thinks out of the same budget adds its own. */
  maxTokens: number;
};

/** The rounds of one turn. It holds the history in the model's own shape. */
export interface ModelConversation {
  /**
   * One round. The model must call a tool — it has no way to answer in loose
   * text — and `only` narrows that to one tool, which is how the last round
   * is made to stop looking and answer.
   */
  ask(only?: string): Promise<ModelCall[]>;
  /** What the last round's calls found, for the next round to read. */
  tell(results: ModelCallResult[]): void;
}

export type DocumentRequest = {
  /** A PDF, or a picture of a paper (a plan's invoice, 4 Oct 2026). */
  file: Buffer;
  mimeType: DocumentMime;
  instruction: string;
  /** The one tool the reading has to come back through. */
  tool: ModelTool;
  maxTokens: number;
};

/** What a document handed to the model may be. */
export type DocumentMime =
  "application/pdf" | "image/png" | "image/jpeg" | "image/webp";

/**
 * The tokens one call to a model counted (B3, 4 Oct 2026), as `ai_usage`
 * keeps them: input at the full rate (cached input not in it), the cache
 * read and written, the output, and Gemini's thinking, which Google counts
 * apart. Claude counts its thinking inside its output: null there.
 */
export type ModelUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  thinkingTokens: number | null;
};

/** Told of every call the moment its answer arrives, to be counted. */
export type UsageMeter = (usage: ModelUsage) => void;

export interface TurnModel {
  converse(request: TurnRequest): ModelConversation;
  /**
   * A PDF or a picture, read into one call of `tool`. `input` is null when the model did
   * not call it; `truncated` is true when it ran out of room, in which case
   * whatever it did produce is not to be trusted as the whole document.
   */
  readDocument(
    request: DocumentRequest,
  ): Promise<{ input: unknown; truncated: boolean }>;
}

/**
 * Claude — with an Anthropic key, or on Vertex AI. The two clients take the
 * same requests, so this is one adapter for both.
 */
export function claudeModel(
  client: ClaudeClient,
  model: string,
  meter?: UsageMeter,
): TurnModel {
  return {
    converse(request) {
      const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      return {
        async ask(only) {
          const response = await client.messages.create({
            model,
            max_tokens: request.maxTokens,
            /**
             * Two blocks, and the breakpoint between them is the point.
             *
             * Everything up to the mark is identical on every turn of every
             * conversation, so after the first request it is read from cache at
             * about a tenth of the price. Tools are rendered before `system`, so
             * one mark on the last stable block covers those too. What follows it
             * — today, who is asking, the file, the draft so far — is cheap and
             * changes constantly, which is exactly why it is after.
             *
             * Note this pays for itself inside a single conversation: the write
             * costs a quarter more than a plain request, and the second turn
             * already reads it back.
             */
            system: [
              {
                type: "text",
                text: request.stablePrompt,
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: request.turnPrompt },
            ],
            messages,
            tools: request.tools,
            tool_choice: only ? { type: "tool", name: only } : { type: "any" },
          });

          meter?.(claudeUsage(response.usage));

          const calls = response.content.filter((c) => c.type === "tool_use");
          // Its own words go back with the results: a `tool_result` has to
          // answer a `tool_use` the history actually contains.
          if (calls.length) {
            messages.push({ role: "assistant", content: response.content });
          }
          return calls.map((call) => ({
            id: call.id,
            name: call.name,
            input: (call.input ?? {}) as Record<string, unknown>,
          }));
        },

        tell(results) {
          messages.push({
            role: "user",
            content: results.map((result) => ({
              type: "tool_result" as const,
              tool_use_id: result.call.id,
              content: result.text,
              is_error: !result.ok,
            })),
          });
        },
      };
    },

    async readDocument(request) {
      const response = await client.messages
        .stream({
          model,
          max_tokens: request.maxTokens,
          messages: [
            {
              role: "user",
              content: [
                request.mimeType === "application/pdf"
                  ? {
                      type: "document",
                      source: {
                        type: "base64",
                        media_type: "application/pdf",
                        data: request.file.toString("base64"),
                      },
                    }
                  : {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: request.mimeType,
                        data: request.file.toString("base64"),
                      },
                    },
                { type: "text", text: request.instruction },
              ],
            },
          ],
          tools: [request.tool],
          tool_choice: { type: "tool", name: request.tool.name },
        })
        .finalMessage();
      meter?.(claudeUsage(response.usage));

      const call = response.content.find(
        (block) =>
          block.type === "tool_use" && block.name === request.tool.name,
      );
      return {
        input: call?.type === "tool_use" ? call.input : null,
        truncated: response.stop_reason === "max_tokens",
      };
    },
  };
}

/**
 * Claude's counts as `ai_usage` keeps them. Its input excludes what was read
 * from or written to the cache, which come back on their own lines; its
 * thinking is inside its output.
 */
export function claudeUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): ModelUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    thinkingTokens: null,
  };
}
