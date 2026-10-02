import {
  AI_MODEL_LABELS,
  AI_MODEL_RETIRING,
  type AiModel,
} from "@finance/shared";
import { ApiError } from "@google/genai";

/**
 * A refusal on the way to Gemini, kept as what it was.
 *
 * `kind` says where it stopped: Google would not exchange the key for a token
 * (`key`), Google was not reached (`network`), or Vertex AI answered with a
 * status (`api`). The message is Google's own words with anything secret cut
 * out, so it is safe to log — and it is logged every time, explained or not.
 * The Vertex check in connections.service.ts logged only what it could not
 * explain, and the one refusal that mattered (a quota of zero, 2 Oct 2026)
 * was explained wrongly and never written down.
 */
export class GeminiError extends Error {
  constructor(
    readonly kind: "key" | "network" | "api",
    readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * What the SDK threw, as a `GeminiError` — or the error itself when it is not
 * Google's. A fault of this app's own must go on being thrown as one, not
 * dressed up as something the owner could fix in a console.
 */
export function asGeminiError(error: unknown): unknown {
  if (error instanceof GeminiError) return error;

  if (error instanceof ApiError) {
    return new GeminiError("api", error.status, scrub(error.message));
  }

  // google-auth-library's refusal carries the token endpoint's response, and
  // says which OAuth error it was.
  const response = (error as { response?: { status?: number } } | null)
    ?.response;
  if (
    error instanceof Error &&
    (response ||
      /invalid_grant|invalid_client|unauthorized_client|invalid jwt/i.test(
        error.message,
      ))
  ) {
    return new GeminiError("key", response?.status, scrub(error.message));
  }

  // `fetch failed`, a timeout, an abort: nothing came back at all.
  if (
    error instanceof Error &&
    /fetch failed|abort|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(
      `${error.name} ${error.message}`,
    )
  ) {
    const cause =
      error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return new GeminiError(
      "network",
      undefined,
      scrub(`${error.name}: ${error.message}${cause}`),
    );
  }

  return error;
}

/**
 * The refusal in words — or null when the error is not Google's.
 *
 * The same kind of sentence claude-errors.ts gives: the cause is nearly
 * always one console step, and only reads as one if it is named.
 */
export function explainGeminiError(
  error: unknown,
  context: { model: string; region: string },
): string | null {
  if (!(error instanceof GeminiError)) return null;

  if (error.kind === "network") {
    return "Could not reach Google Cloud. Try again in a moment.";
  }
  if (error.kind === "key" || error.status === 401) {
    return `Google refused the service-account key (${said(error.message)}). It may have been deleted or disabled in Google Cloud; a Super Admin can add a new one under Settings → Connections.`;
  }

  const message = error.message;

  if (error.status === 403) {
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(message)) {
      return "The Vertex AI API is not switched on in the Google Cloud project. Enable it under APIs & Services, then try again.";
    }
    if (/billing/i.test(message)) {
      return "The Google Cloud project has no billing account attached. Attach one under Billing, then try again.";
    }
    return `Google Cloud refused: either the service account is missing the "Vertex AI User" role, or ${context.model} is not available to this project.`;
  }
  if (error.status === 404) {
    const missing = `${context.model} is not available to this Google Cloud project in the "${context.region}" region.`;
    // A model Google has taken away answers 404 too, and Model Garden will
    // not bring it back: the way out is the model that replaced it.
    const retiring = AI_MODEL_RETIRING[context.model as AiModel];
    return retiring
      ? `${missing} Google retires it ${retiring.when}. If that is why, a Super Admin can choose ${AI_MODEL_LABELS[retiring.successor]} under Settings → Assistant.`
      : `${missing} Check it in Vertex AI → Model Garden, then try again.`;
  }
  if (error.status === 429) {
    return "The Google Cloud project's quota for Gemini is used up for now. Wait a minute, or ask Google for more under IAM & Admin → Quotas.";
  }
  if (error.status === 400) {
    // Not something a console step mends: the request itself was refused.
    return `Google Cloud would not take the request (${said(message)}). That is a fault in this app, not in the Google Cloud setup.`;
  }
  if (error.status !== undefined && error.status >= 500) {
    return "Google Cloud is not answering at the moment. Try again shortly.";
  }
  return `Google Cloud said: ${said(message)}`;
}

/**
 * Google's sentence out of Google's JSON.
 *
 * The SDK's message is the whole error body as a string; the part a person
 * can read is `error.message` inside it.
 */
function said(message: string): string {
  try {
    const body = JSON.parse(message) as {
      error?: { message?: unknown } | string;
      error_description?: unknown;
    };
    const inner =
      typeof body.error === "object" ? body.error?.message : body.error;
    const words = [inner, body.error_description].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (words.length) return words.join(": ").slice(0, 300);
  } catch {
    // Not JSON: it is already a sentence.
  }
  return message.slice(0, 300);
}

/**
 * Anything that could be a credential, cut out before it is logged.
 *
 * Google's errors do not carry the key. This is for the day one does: a
 * private key block, a `private_key` field, an access token, a signed JWT.
 */
export function scrub(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      "[private key removed]",
    )
    .replace(/("private_key"\s*:\s*")[^"]*"/g, '$1[removed]"')
    .replace(/\bya29\.[\w.-]+/g, "[token removed]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token removed]")
    .slice(0, 2_000);
}
