/**
 * The Google Cloud key (#131): what is accepted, and where Claude is asked.
 *
 * No real key and no network. The token step is the one place Google itself
 * is reached, so it is stubbed; everything after it — the Vertex URL, the
 * body, the words a refusal turns into — is this app's own code and is pinned
 * here.
 */
import { generateKeyPairSync } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { JWT } from "google-auth-library";

import { seal } from "../../common/crypto/secret-box";
import { explainClaudeError } from "../ai-intake/claude-errors";
import { openServiceAccount, readServiceAccount, vertexClient } from "./google";

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

const problem = (text: string) => {
  const read = readServiceAccount(text);
  return "problem" in read ? read.problem : null;
};

describe("readServiceAccount", () => {
  it("accepts the JSON Google downloads", () => {
    const read = readServiceAccount(JSON.stringify(KEY, null, 2));
    expect("account" in read && read.account.client_email).toBe(
      KEY.client_email,
    );
  });

  it("refuses what is not JSON", () => {
    expect(problem("sk-ant-abc")).toMatch(/not the JSON key/);
  });

  it("refuses another kind of Google JSON, by name", () => {
    // An OAuth client's file, the usual wrong download from the same page.
    expect(problem(JSON.stringify({ installed: { client_id: "x" } }))).toMatch(
      /not a service-account key/,
    );
  });

  it("names the field that is missing", () => {
    const { private_key: _, ...rest } = KEY;
    expect(problem(JSON.stringify(rest))).toMatch(/no private_key/);
  });

  it("refuses a person's address", () => {
    expect(
      problem(JSON.stringify({ ...KEY, client_email: "owner@gmail.com" })),
    ).toMatch(/not a service account's address/);
  });

  it("refuses a private key a paste has broken", () => {
    const clipped = KEY.private_key.split("\n").slice(0, 5).join("\n");
    expect(problem(JSON.stringify({ ...KEY, private_key: clipped }))).toMatch(
      /cannot be read/,
    );
  });
});

describe("openServiceAccount", () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = "a-test-key-of-more-than-sixteen-chars";
  });
  afterAll(() => {
    process.env = saved;
  });

  it("opens what was sealed", () => {
    expect(openServiceAccount(seal(JSON.stringify(KEY)))?.project_id).toBe(
      "sfm-assistant",
    );
  });

  it("is null when nothing is stored", () => {
    expect(openServiceAccount(null)).toBeNull();
  });
});

describe("vertexClient", () => {
  afterEach(() => jest.restoreAllMocks());

  it("asks Vertex for the bare model id, in the project and region, with Google's token", async () => {
    jest
      .spyOn(JWT.prototype, "getRequestHeaders")
      .mockResolvedValue(new Headers({ authorization: "Bearer test-token" }));

    const calls: { url: string; init: RequestInit }[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      calls.push({
        url: url instanceof Request ? url.url : url.toString(),
        init: init ?? {},
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            content: [{ type: "text", text: "hi" }],
            stop_reason: "max_tokens",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });

    const account = readServiceAccount(JSON.stringify(KEY));
    if (!("account" in account)) throw new Error(account.problem);

    await vertexClient(account.account, "global", {
      maxRetries: 0,
    }).messages.create({
      model: "claude-opus-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/sfm-assistant/locations/global/publishers/anthropic/models/claude-opus-5:rawPredict",
    );
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    // No Anthropic credential may travel to Google.
    expect(headers.get("x-api-key")).toBeNull();

    const body = JSON.parse(calls[0].init.body as string) as Record<
      string,
      unknown
    >;
    expect(body.model).toBeUndefined();
    expect(body.anthropic_version).toBe("vertex-2023-10-16");
  });

  it("turns a key Google will not accept into words", async () => {
    jest
      .spyOn(JWT.prototype, "getRequestHeaders")
      .mockRejectedValue(new Error("invalid_grant: Invalid JWT Signature."));

    const account = readServiceAccount(JSON.stringify(KEY));
    if (!("account" in account)) throw new Error(account.problem);

    const error = await vertexClient(account.account, "global", {
      maxRetries: 0,
    })
      .messages.create({
        model: "claude-opus-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      })
      .catch((caught: unknown) => caught);

    expect(
      explainClaudeError(error, "vertex", {
        model: "claude-opus-5",
        region: "global",
      }),
    ).toMatch(
      /^Google refused the service-account key \(invalid_grant: Invalid JWT Signature\.\)/,
    );
  });
});

describe("explainClaudeError", () => {
  const context = { model: "claude-opus-5", region: "global" };
  const status = (code: number, message: string) =>
    Anthropic.APIError.generate(
      code,
      { error: { message } },
      message,
      new Headers(),
    );

  it("leaves errors that are not Anthropic's or Google's alone", () => {
    expect(explainClaudeError(new Error("db"), "vertex", context)).toBeNull();
  });

  it("keeps Anthropic's words for Anthropic", () => {
    expect(
      explainClaudeError(
        status(403, "identity verification required"),
        "anthropic",
        context,
      ),
    ).toMatch(/^Anthropic needs the account verified/);
  });

  it("says the model is not enabled when Vertex cannot find it", () => {
    expect(
      explainClaudeError(
        status(404, "Publisher Model was not found"),
        "vertex",
        context,
      ),
    ).toMatch(/claude-opus-5 is not enabled .* "global" region.*Model Garden/);
  });

  it("tells a switched-off API from a missing role", () => {
    expect(
      explainClaudeError(
        status(
          403,
          "Vertex AI API has not been used in project 123 before or it is disabled",
        ),
        "vertex",
        context,
      ),
    ).toMatch(/Vertex AI API is not switched on/);
    expect(
      explainClaudeError(
        status(403, "Permission 'aiplatform.endpoints.predict' denied"),
        "vertex",
        context,
      ),
    ).toMatch(/"Vertex AI User" role.*Model Garden/);
  });

  it("names the quota on a 429", () => {
    expect(
      explainClaudeError(status(429, "Quota exceeded"), "vertex", context),
    ).toMatch(/quota for Claude/);
  });
});
