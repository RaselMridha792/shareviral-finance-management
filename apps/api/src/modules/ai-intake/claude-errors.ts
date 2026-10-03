import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "@finance/shared";

/**
 * The client the assistant talks to, whichever way it reaches Claude.
 *
 * `AnthropicVertex` is not an `Anthropic` — it has no Batches, Files or Models
 * API — but it carries the same `messages.create` and `messages.stream`, and
 * those two are all this module uses.
 */
export type ClaudeClient = {
  messages: Pick<Anthropic["messages"], "create" | "stream">;
};

/**
 * A refusal from Anthropic or from Google, said in words — or null when the
 * error is not one of theirs and should go on being thrown.
 *
 * The cause is nearly always something the owner can fix in a couple of
 * minutes, but only if told which: a model not enabled in Model Garden and a
 * missing role look identical as "Internal server error".
 *
 * Vertex raises the same error classes as the Anthropic SDK (it re-exports
 * them), with Google's status and Google's message inside. A key Google will
 * not exchange for a token arrives as a connection error, because fetching
 * the token is the SDK's first network call.
 */
export function explainClaudeError(
  error: unknown,
  provider: AiProvider,
  context: { model: string; region: string },
): string | null {
  if (!(error instanceof Anthropic.APIError)) return null;

  if (provider === "anthropic") {
    return error.status === 401
      ? "Anthropic rejected the API key. A Super Admin can replace it in the Assistant's settings."
      : error.status === 403 ||
          /identity verification/i.test(error.message ?? "")
        ? "Anthropic needs the account verified before it will answer. Whoever owns the key can do that at console.anthropic.com; nothing needs changing here."
        : error.status === 429
          ? "The Anthropic account is over its rate limit, or has no credit left."
          : error.status >= 500
            ? "Anthropic is not answering at the moment. Try again shortly."
            : `Anthropic said: ${error.message}`;
  }

  const message = error.message ?? "";

  if (error instanceof Anthropic.APIConnectionError) {
    // The SDK's own words are "Failed to acquire Google OAuth credentials";
    // the reason Google gave sits in the cause.
    if (/google oauth/i.test(message)) {
      const cause =
        error.cause instanceof Error ? error.cause.message.slice(0, 200) : "";
      return (
        "Google refused the service-account key" +
        (cause ? ` (${cause})` : "") +
        ". It may have been deleted or disabled in Google Cloud; a Super Admin can add a new one in the Assistant's settings."
      );
    }
    return "Could not reach Google Cloud. Try again in a moment.";
  }

  if (error.status === 401) {
    return "Google refused the service-account key. A Super Admin can add a new one in the Assistant's settings.";
  }
  if (error.status === 403) {
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(message)) {
      return "The Vertex AI API is not switched on in the Google Cloud project. Enable it under APIs & Services, then try again.";
    }
    if (/billing/i.test(message)) {
      return "The Google Cloud project has no billing account attached. Attach one under Billing, then try again.";
    }
    return `Google Cloud refused: either the service account is missing the "Vertex AI User" role, or ${context.model} has not been enabled in Vertex AI → Model Garden.`;
  }
  if (error.status === 404) {
    return `${context.model} is not enabled for this Google Cloud project in the "${context.region}" region. Enable it in Vertex AI → Model Garden, accepting the terms, then try again.`;
  }
  if (error.status === 429) {
    return "The Google Cloud project's quota for Claude is used up for now. Wait a minute, or ask Google for more under IAM & Admin → Quotas.";
  }
  if (error.status !== undefined && error.status >= 500) {
    return "Google Cloud is not answering at the moment. Try again shortly.";
  }
  return `Google Cloud said: ${message}`;
}
