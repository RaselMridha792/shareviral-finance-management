import {
  AI_TARGET_ENDPOINT,
  type AiAvailability,
  type AiKeyResult,
  type AiIntakeReply,
  type AiIntakeRequest,
  type AiTarget,
} from "@finance/shared";

import { apiFetch } from "./api-client";

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const aiApi = {
  availability: () =>
    apiFetch<AiAvailability>("/ai/availability", { cache: "no-store" }),

  /**
   * The key travels one way. Nothing this module receives ever contains it —
   * only whether one is set and its last four characters.
   */
  setKey: (apiKey: string) =>
    apiFetch<AiKeyResult>("/ai/key", {
      method: "POST",
      ...json({ apiKey }),
    }),

  clearKey: () => apiFetch<AiKeyResult>("/ai/key", { method: "DELETE" }),

  turn: (request: AiIntakeRequest) =>
    apiFetch<AiIntakeReply>("/ai/turn", { method: "POST", ...json(request) }),

  /**
   * Saving goes to the record's own endpoint, not to anything AI-specific.
   *
   * That is the whole safety argument: the assistant produced some values, and
   * from here on this is an ordinary create. The same permission check, the
   * same Zod schema, the same audit row. `created_via` marks where it came
   * from so the provenance is visible afterwards.
   */
  save: async (target: AiTarget, draft: Record<string, unknown>) => {
    const resolved = await apiFetch<Record<string, unknown>>("/ai/resolve", {
      method: "POST",
      ...json({ draft }),
    });

    const body: Record<string, unknown> = { ...resolved };
    if (target === "transaction_in" || target === "transaction_out") {
      body.direction = target === "transaction_in" ? "in" : "out";
      body.createdVia = "ai_intake";
    }

    return apiFetch<{ refNo?: string; id: string }>(AI_TARGET_ENDPOINT[target], {
      method: "POST",
      ...json(body),
    });
  },
};
