import { createPrivateKey } from "node:crypto";

import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleGenAI } from "@google/genai";
import { GoogleAuth, JWT, type JWTInput } from "google-auth-library";

import { open } from "../../common/crypto/secret-box";

/**
 * The Google Cloud service account, read and put to use.
 *
 * One key, two jobs (docs/briefs/2026-10-01-google-connections.md): Claude
 * through Vertex AI, and reading the Sheets and Docs the owner shares with the
 * account. The JSON is held sealed in `app_settings.google_service_account`;
 * the project and the client email are read out of it rather than stored
 * twice, so they can never disagree with the key.
 */
export type ServiceAccount = JWTInput & {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
};

/** Vertex wants the broad scope; Google offers nothing narrower for it. */
const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Read-only, all three. The app reads what was shared with it and nothing
 * else, and with these scopes it could not write to a file even if some
 * future line of code tried.
 */
export const GOOGLE_READ_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * The pasted text, as a service account — or the one thing wrong with it.
 *
 * Each refusal names the part that is missing, because the usual mistake is a
 * different JSON file from the same console (an OAuth client, or the key's
 * metadata), and "invalid key" would send them looking in the wrong place.
 */
export function readServiceAccount(
  text: string,
): { account: ServiceAccount } | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      problem:
        "That is not the JSON key. Paste the whole file Google downloaded, from the first { to the last }.",
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { problem: "That is not the JSON key Google downloads." };
  }
  const json = parsed as Record<string, unknown>;

  if (json.type !== "service_account") {
    return {
      problem:
        "That JSON is not a service-account key. In Google Cloud: IAM → Service accounts → the account → Keys → Add key → JSON.",
    };
  }

  for (const field of ["project_id", "client_email", "private_key"] as const) {
    if (typeof json[field] !== "string" || !json[field].trim()) {
      return {
        problem: `The key has no ${field}. Paste the whole file, unchanged.`,
      };
    }
  }

  const email = json.client_email as string;
  if (!/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(email)) {
    return {
      problem: `${email} is not a service account's address. Paste the key of a service account, not of a person.`,
    };
  }

  // Caught here rather than on the first request, where it would surface as a
  // signing error nobody could connect to a clipped paste.
  try {
    createPrivateKey(json.private_key as string);
  } catch {
    return {
      problem:
        "The private_key in that JSON cannot be read — usually a paste that lost a line. Paste the file again, whole.",
    };
  }

  // Every field the type promises was checked above.
  return { account: json as unknown as ServiceAccount };
}

/** The stored key, opened; null when none is stored or it cannot be read. */
export function openServiceAccount(
  sealed: string | null | undefined,
): ServiceAccount | null {
  const text = open(sealed);
  if (!text) return null;
  const read = readServiceAccount(text);
  return "account" in read ? read.account : null;
}

/** Credentials from the stored JSON, never from the machine's environment. */
export function googleAuth(account: ServiceAccount, scopes: string | string[]) {
  return new GoogleAuth({
    credentials: account,
    projectId: account.project_id,
    scopes,
  });
}

/**
 * Claude through Vertex AI, with the same `messages` surface as `Anthropic`.
 *
 * The model id is the bare one (`claude-opus-5`) on Vertex too. Built per
 * call, like the Anthropic client: the key can change from Settings at any
 * moment.
 */
export function vertexClient(
  account: ServiceAccount,
  region: string,
  options: { maxRetries?: number; timeout?: number } = {},
) {
  return new AnthropicVertex({
    projectId: account.project_id,
    region,
    googleAuth: googleAuth(account, VERTEX_SCOPE),
    ...options,
  });
}

/**
 * Gemini on the same project, with the same key (2 Oct 2026).
 *
 * `enterprise: true` is the SDK's name for "through Google Cloud, not with an
 * AI Studio key" — the README's own constructor. The stored key signs the
 * requests and the project and region are named, so the machine's environment
 * is never consulted: no `GOOGLE_API_KEY`, and no application-default login.
 *
 * The key is handed over as a ready client rather than as `credentials`. It
 * is the same key either way; given as `credentials` the SDK writes a line
 * about "the API key from the environment variable" to the log on every
 * turn, and there is no such key.
 *
 * `attempts` counts the first request too, so 1 means no retry. The SDK does
 * not retry at all unless told to.
 */
export function geminiClient(
  account: ServiceAccount,
  region: string,
  options: { attempts?: number; timeout?: number } = {},
) {
  return new GoogleGenAI({
    enterprise: true,
    project: account.project_id,
    location: region,
    googleAuthOptions: {
      authClient: new JWT({
        email: account.client_email,
        key: account.private_key,
        keyId: account.private_key_id,
        scopes: VERTEX_SCOPE,
      }),
      projectId: account.project_id,
    },
    httpOptions: {
      ...(options.timeout ? { timeout: options.timeout } : {}),
      ...(options.attempts && options.attempts > 1
        ? { retryOptions: { attempts: options.attempts } }
        : {}),
    },
  });
}
