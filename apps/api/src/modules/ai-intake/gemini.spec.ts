/**
 * Gemini through the Google Cloud key (2 Oct 2026): what is sent, what comes
 * back, and the words a refusal turns into.
 *
 * No real key and no network, as in google.spec.ts: Google's token is
 * stubbed, and `fetch` is a list of replies. What is pinned is this app's own
 * half — the turn, said in Google's terms. Whether Gemini answers *well* is
 * not a unit test's question; that is `.assistantbar.mjs`, against the real
 * model.
 */
import { generateKeyPairSync } from "node:crypto";

import { JWT } from "google-auth-library";

import { geminiClient, readServiceAccount } from "../connections/google";
import { geminiModel } from "./gemini";
import {
  GeminiError,
  asGeminiError,
  explainGeminiError,
  scrub,
} from "./gemini-errors";
import type { ModelTool } from "./model-turn";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const KEY = {
  type: "service_account",
  project_id: "sfm-assistant",
  private_key_id: "0123456789abcdef",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "sfm-assistant@sfm-assistant.iam.gserviceaccount.com",
  client_id: "123456789",
  token_uri: "https://oauth2.googleapis.com/token",
};

const MODEL = "gemini-2.5-pro";
const BASE =
  "https://aiplatform.googleapis.com/v1beta1/projects/sfm-assistant/locations/global/publishers/google/models/gemini-2.5-pro";

const TOOLS: ModelTool[] = [
  {
    name: "account_balances",
    description: "Every account and what is in it right now.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "answer",
    description: "Give the final answer.",
    input_schema: {
      type: "object",
      properties: {
        draft: { type: "object", additionalProperties: true },
        missingFields: { type: "array", items: { type: "string" } },
      },
      required: ["draft", "missingFields"],
    },
  },
];

type Sent = { url: string; headers: Headers; body: Record<string, unknown> };

function model() {
  const account = readServiceAccount(JSON.stringify(KEY));
  if (!("account" in account)) throw new Error(account.problem);
  return geminiModel(geminiClient(account.account, "global"), MODEL);
}

/** Google's token, stubbed; then each reply in turn, and what was sent. */
function google(...replies: Response[]): Sent[] {
  jest
    .spyOn(JWT.prototype, "getRequestHeaders")
    .mockResolvedValue(new Headers({ authorization: "Bearer test-token" }));

  const sent: Sent[] = [];
  jest.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    sent.push({
      url: url instanceof Request ? url.url : url.toString(),
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("No reply left for this request");
    return Promise.resolve(reply);
  });
  return sent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const calling = (...parts: unknown[]) =>
  json({
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
  });

const turn = () =>
  model().converse({
    stablePrompt: "STABLE",
    turnPrompt: "TURN",
    messages: [
      { role: "user", content: "how much do we have" },
      { role: "assistant", content: "Looking." },
      { role: "user", content: "well?" },
    ],
    tools: TOOLS,
    maxTokens: 8_000,
  });

afterEach(() => jest.restoreAllMocks());

describe("geminiModel: a turn", () => {
  it("is asked on the project's own Vertex endpoint, with Google's token and no API key", async () => {
    const sent = google(
      calling({ functionCall: { name: "answer", args: { draft: {} } } }),
    );
    await turn().ask();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${BASE}:generateContent`);
    expect(sent[0].headers.get("authorization")).toBe("Bearer test-token");
    expect(sent[0].headers.get("x-goog-api-key")).toBeNull();
  });

  it("says the turn in Google's terms: the prompt, the history, the tools, and a tool it must call", async () => {
    const sent = google(
      calling({ functionCall: { name: "answer", args: { draft: {} } } }),
    );
    await turn().ask();
    const body = sent[0].body;

    // The stable half first: that is the prefix Google caches on its own.
    expect(body.systemInstruction).toMatchObject({
      parts: [{ text: "STABLE" }, { text: "TURN" }],
    });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "how much do we have" }] },
      { role: "model", parts: [{ text: "Looking." }] },
      { role: "user", parts: [{ text: "well?" }] },
    ]);
    // The schemas cross as they are.
    expect(body.tools).toEqual([
      {
        functionDeclarations: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.input_schema,
        })),
      },
    ]);
    expect(body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
    // Thinking is paid for out of the same allowance, so it is doubled.
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 16_000 });
    // Nothing of Claude's travels.
    expect(JSON.stringify(body)).not.toMatch(
      /cache_control|tool_choice|input_schema/,
    );
  });

  it("hands a look-up's result back beside Gemini's own call, signature and all", async () => {
    const asked = {
      functionCall: { name: "account_balances", args: {} },
      thoughtSignature: "c2lnbmF0dXJl",
    };
    const sent = google(
      calling(asked),
      calling({
        functionCall: {
          name: "answer",
          args: { draft: {}, missingFields: [] },
        },
      }),
    );
    const conversation = turn();

    const first = await conversation.ask();
    expect(first).toEqual([
      { id: "local-1-0", name: "account_balances", input: {} },
    ]);

    conversation.tell([{ call: first[0], text: "Bank: 12,000.00", ok: true }]);
    const second = await conversation.ask();
    expect(second[0]).toMatchObject({
      name: "answer",
      input: { draft: {}, missingFields: [] },
    });

    const contents = sent[1].body.contents as unknown[];
    expect(contents.slice(-2)).toEqual([
      { role: "model", parts: [asked] },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "account_balances",
              response: { output: "Bank: 12,000.00" },
            },
          },
        ],
      },
    ]);
  });

  it("returns an id Gemini gave, and says a refused look-up is an error", async () => {
    const sent = google(
      calling({
        functionCall: { id: "fc_7", name: "account_balances", args: {} },
      }),
      calling({ functionCall: { name: "answer", args: {} } }),
    );
    const conversation = turn();
    const [call] = await conversation.ask();
    conversation.tell([{ call, text: "Refused: no permission.", ok: false }]);
    await conversation.ask();

    expect((sent[1].body.contents as unknown[]).at(-1)).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "fc_7",
            name: "account_balances",
            response: { error: "Refused: no permission." },
          },
        },
      ],
    });
  });

  it("is held to `answer` alone on the last round", async () => {
    const sent = google(
      calling({ functionCall: { name: "answer", args: {} } }),
    );
    await turn().ask("answer");

    expect(sent[0].body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["answer"] },
    });
  });

  it("returns no calls, and no history, when Gemini called nothing", async () => {
    const sent = google(
      json({ candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] }),
      calling({ functionCall: { name: "answer", args: {} } }),
    );
    const conversation = turn();

    expect(await conversation.ask()).toEqual([]);
    await conversation.ask();
    expect(sent[1].body.contents).toEqual(sent[0].body.contents);
  });
});

describe("geminiModel: a PDF", () => {
  const TOOL: ModelTool = {
    name: "statement_rows",
    description: "Return the statement's own table.",
    input_schema: {
      type: "object",
      properties: { headers: { type: "array", items: { type: "string" } } },
      required: ["headers"],
    },
  };

  const stream = (...chunks: unknown[]) =>
    new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );

  const read = () =>
    model().readDocument({
      pdf: Buffer.from("%PDF-1.4 test"),
      instruction: "Transcribe.",
      tool: TOOL,
      maxTokens: 32_000,
    });

  it("sends the file inline, streamed, through the one tool", async () => {
    const sent = google(
      stream({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "statement_rows",
                    args: { headers: ["Date", "Debit"] },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }),
    );

    expect(await read()).toEqual({
      input: { headers: ["Date", "Debit"] },
      truncated: false,
    });

    expect(sent[0].url).toBe(`${BASE}:streamGenerateContent?alt=sse`);
    expect(sent[0].body.contents).toEqual([
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: Buffer.from("%PDF-1.4 test").toString("base64"),
            },
          },
          { text: "Transcribe." },
        ],
      },
    ]);
    expect(sent[0].body.toolConfig).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["statement_rows"],
      },
    });
  });

  it("says so when the statement ran out of room", async () => {
    google(stream({ candidates: [{ finishReason: "MAX_TOKENS" }] }));
    expect(await read()).toEqual({ input: null, truncated: true });
  });
});

describe("Gemini's refusals, in words", () => {
  const context = { model: MODEL, region: "global" };
  const refused = (status: number, message: string, extra = {}) =>
    json({ error: { code: status, message, ...extra } }, status);
  const failure = async (reply: Response) => {
    google(reply);
    return turn()
      .ask()
      .catch((caught: unknown) => caught);
  };

  it("names the quota on a 429, and keeps Google's own words for the log", async () => {
    const error = await failure(
      refused(429, "Quota exceeded for aiplatform.googleapis.com"),
    );

    expect(error).toBeInstanceOf(GeminiError);
    expect(error).toMatchObject({ kind: "api", status: 429 });
    expect((error as GeminiError).message).toMatch(/Quota exceeded for/);
    expect(explainGeminiError(error, context)).toMatch(/quota for Gemini/);
  });

  it("tells a switched-off API and a missing billing account from a missing role", async () => {
    expect(
      explainGeminiError(
        await failure(
          refused(403, "Vertex AI API has not been used in project 1", {
            details: [{ reason: "SERVICE_DISABLED" }],
          }),
        ),
        context,
      ),
    ).toMatch(/Vertex AI API is not switched on/);
    expect(
      explainGeminiError(
        await failure(refused(403, "This API method requires billing")),
        context,
      ),
    ).toMatch(/no billing account/);
    expect(
      explainGeminiError(
        await failure(
          refused(403, "Permission 'aiplatform.endpoints.predict' denied"),
        ),
        context,
      ),
    ).toMatch(/"Vertex AI User" role, or gemini-2.5-pro is not available/);
  });

  it("says the model is not there on a 404", async () => {
    expect(
      explainGeminiError(
        await failure(refused(404, "Publisher Model was not found")),
        context,
      ),
    ).toMatch(/gemini-2.5-pro is not available .* "global" region/);
  });

  it("owns up to a bad request, in Google's words", async () => {
    expect(
      explainGeminiError(
        await failure(refused(400, "Invalid JSON payload received.")),
        context,
      ),
    ).toBe(
      "Google Cloud would not take the request (Invalid JSON payload received.). That is a fault in this app, not in the Google Cloud setup.",
    );
  });

  it("says Google is down on a 5xx", async () => {
    expect(
      explainGeminiError(await failure(refused(503, "Unavailable")), context),
    ).toMatch(/not answering at the moment/);
  });

  it("turns a key Google will not accept into words", async () => {
    jest
      .spyOn(JWT.prototype, "getRequestHeaders")
      .mockRejectedValue(new Error("invalid_grant: Invalid JWT Signature."));

    const error = await turn()
      .ask()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: "key" });
    expect(explainGeminiError(error, context)).toMatch(
      /^Google refused the service-account key \(invalid_grant: Invalid JWT Signature\.\)/,
    );
  });

  it("says Google was not reached when nothing came back", async () => {
    jest
      .spyOn(JWT.prototype, "getRequestHeaders")
      .mockResolvedValue(new Headers({ authorization: "Bearer test-token" }));
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));

    const error = await turn()
      .ask()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ kind: "network" });
    expect(explainGeminiError(error, context)).toMatch(
      /^Could not reach Google Cloud/,
    );
  });

  it("leaves an error that is not Google's as it was", () => {
    const own = new Error("relation does not exist");
    expect(asGeminiError(own)).toBe(own);
    expect(explainGeminiError(own, context)).toBeNull();
  });

  it("cuts a key or a token out of anything it logs", () => {
    const logged = scrub(
      `failed with ${KEY.private_key} and {"private_key":"abc"} and Bearer ya29.a0AfH6SMBx-secret`,
    );
    expect(logged).not.toContain(KEY.private_key.split("\n")[1]);
    expect(logged).not.toContain("abc");
    expect(logged).not.toContain("a0AfH6SMBx");
    expect(logged).toMatch(/\[private key removed\]/);
  });
});
