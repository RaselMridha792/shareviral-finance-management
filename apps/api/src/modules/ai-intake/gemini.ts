import {
  FinishReason,
  FunctionCallingConfigMode,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type GoogleGenAI,
  type Part,
} from "@google/genai";
import { Logger } from "@nestjs/common";

import { asGeminiError } from "./gemini-errors";
import type { ModelCall, ModelTool, TurnModel } from "./model-turn";

/**
 * Gemini on Vertex AI, as a `TurnModel` (2 Oct 2026).
 *
 * The same turn Claude is given, said in Google's terms:
 *
 *   system            -> config.systemInstruction
 *   tools             -> one `functionDeclarations` list, the schemas as they are
 *   tool_choice any   -> functionCallingConfig mode ANY
 *   tool_choice tool  -> mode ANY, allowedFunctionNames: [that one]
 *   tool_use          -> a `functionCall` part, role "model"
 *   tool_result       -> a `functionResponse` part, role "user"
 *   document block    -> `inlineData`, application/pdf
 *   cache_control     -> nothing: Google caches a repeated prefix on its own
 *
 * The client is anything with `models`, so a test can hand one in.
 */
export type GeminiClient = Pick<GoogleGenAI, "models">;

const log = new Logger("Gemini");

/**
 * Gemini thinks before it answers, and the thinking is spent out of the same
 * `maxOutputTokens` as the reply. Asked for exactly the reply's size, a hard
 * question would think its budget away and come back cut off — so it is given
 * the reply's room again for thinking. A ceiling, not a bill.
 */
const THINKING_ROOM = 2;

/** The most Gemini will write in one reply, thinking included. */
const GEMINI_MAX_OUTPUT = 65_535;

/** Marks an id made up here, for a call Gemini gave none. */
const LOCAL_ID = "local-";

export function geminiModel(client: GeminiClient, model: string): TurnModel {
  return {
    converse(request) {
      const contents: Content[] = request.messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

      const config = {
        // The stable half first, so the prefix Google caches is the long one.
        systemInstruction: {
          parts: [{ text: request.stablePrompt }, { text: request.turnPrompt }],
        },
        tools: [{ functionDeclarations: request.tools.map(declarationOf) }],
        maxOutputTokens: Math.min(
          request.maxTokens * THINKING_ROOM,
          GEMINI_MAX_OUTPUT,
        ),
      };

      let round = 0;

      return {
        async ask(only) {
          round += 1;
          const response = await sent(() =>
            client.models.generateContent({
              model,
              contents,
              config: {
                ...config,
                toolConfig: {
                  functionCallingConfig: {
                    mode: FunctionCallingConfigMode.ANY,
                    ...(only ? { allowedFunctionNames: [only] } : {}),
                  },
                },
              },
            }),
          );

          const content = response.candidates?.[0]?.content;
          const calls = callsIn(content?.parts, round);

          if (!calls.length) {
            // Said every time: an empty reply reads to the person as "did not
            // answer in the expected shape", and only this says why.
            log.warn(`${model} called no tool: ${whyEmpty(response)}`);
            return [];
          }

          // Pushed back whole. Its parts carry the thought signatures Gemini
          // wants returned with the results, and rebuilding them drops those.
          if (content) contents.push(content);
          return calls;
        },

        tell(results) {
          contents.push({
            role: "user",
            parts: results.map(({ call, text, ok }) => ({
              functionResponse: {
                // Only an id Gemini itself gave is sent back.
                ...(call.id.startsWith(LOCAL_ID) ? {} : { id: call.id }),
                name: call.name,
                response: ok ? { output: text } : { error: text },
              },
            })),
          });
        },
      };
    },

    async readDocument(request) {
      /**
       * Streamed, as the Claude reading is: a long statement takes minutes to
       * write out, and a request that sends nothing back for five of them is
       * dropped by the HTTP client before the answer arrives.
       */
      const stream = await sent(() =>
        client.models.generateContentStream({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: request.pdf.toString("base64"),
                  },
                },
                { text: request.instruction },
              ],
            },
          ],
          config: {
            tools: [{ functionDeclarations: [declarationOf(request.tool)] }],
            toolConfig: {
              functionCallingConfig: {
                mode: FunctionCallingConfigMode.ANY,
                allowedFunctionNames: [request.tool.name],
              },
            },
            maxOutputTokens: Math.min(
              request.maxTokens * THINKING_ROOM,
              GEMINI_MAX_OUTPUT,
            ),
          },
        }),
      );

      const parts: Part[] = [];
      let finish: FinishReason | undefined;
      let last: GenerateContentResponse | undefined;
      await sent(async () => {
        for await (const chunk of stream) {
          last = chunk;
          const candidate = chunk.candidates?.[0];
          parts.push(...(candidate?.content?.parts ?? []));
          finish = candidate?.finishReason ?? finish;
        }
      });

      const call = callsIn(parts, 1).find((c) => c.name === request.tool.name);
      if (!call) {
        log.warn(
          `${model} did not return the document's table: ${last ? whyEmpty(last) : "no reply"}`,
        );
      }

      return {
        input: call ? call.input : null,
        truncated: finish === FinishReason.MAX_TOKENS,
      };
    },
  };
}

/** The tool, declared Google's way. The JSON schema goes across unchanged. */
function declarationOf(tool: ModelTool): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.input_schema,
  };
}

function callsIn(parts: Part[] | undefined, round: number): ModelCall[] {
  return (parts ?? []).flatMap((part, index) =>
    part.functionCall?.name
      ? [
          {
            id: part.functionCall.id ?? `${LOCAL_ID}${round}-${index}`,
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          },
        ]
      : [],
  );
}

/** Why a reply carried no tool call: Google's finish reason, or its block. */
function whyEmpty(response: GenerateContentResponse): string {
  const candidate = response.candidates?.[0];
  return (
    [
      candidate?.finishReason ? `finish ${candidate.finishReason}` : null,
      candidate?.finishMessage,
      response.promptFeedback?.blockReason
        ? `blocked ${response.promptFeedback.blockReason}`
        : null,
      response.promptFeedback?.blockReasonMessage,
    ]
      .filter(Boolean)
      .join(", ") || "no reason given"
  );
}

/** The SDK's call, with whatever Google refused turned into a `GeminiError`. */
async function sent<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw asGeminiError(error);
  }
}
