import {
  AI_TARGET_ENDPOINT,
  type AiAttachment,
  type AiAvailability,
  type AiChat,
  type AiChatSummary,
  type AiImportPlan,
  type AiKeyResult,
  type UpdateAiSettingsInput,
  type AiIntakeReply,
  type AiIntakeRequest,
  type AiTarget,
} from "@finance/shared";

import { API_BASE_URL, ApiError, apiFetch } from "./api-client";

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

  updateSettings: (input: UpdateAiSettingsInput) =>
    apiFetch<AiAvailability>("/ai/settings", {
      method: "PATCH",
      ...json(input),
    }),

  turn: (request: AiIntakeRequest) =>
    apiFetch<AiIntakeReply>("/ai/turn", { method: "POST", ...json(request) }),

  /**
   * The history list. Always the signed-in person's own — the API has no
   * endpoint that returns anybody else's, so there is no id to pass.
   */
  chats: () => apiFetch<AiChatSummary[]>("/ai/chats", { cache: "no-store" }),

  chat: (id: string) =>
    apiFetch<AiChat>(`/ai/chats/${id}`, { cache: "no-store" }),

  removeChat: (id: string) =>
    apiFetch<void>(`/ai/chats/${id}`, { method: "DELETE" }),

  clearChats: () =>
    apiFetch<{ deleted: number }>("/ai/chats", { method: "DELETE" }),

  /**
   * Attaching a file.
   *
   * Multipart, so this cannot go through `apiFetch` — setting a JSON
   * content-type would strip the boundary the server needs to find the file.
   * The cookie and the CSRF header still travel.
   */
  attach: async (file: File): Promise<AiAttachment> => {
    const body = new FormData();
    body.append("file", file);

    const response = await fetch(`${API_BASE_URL}/ai/attachments`, {
      method: "POST",
      headers: { "X-Requested-With": "finance-web" },
      credentials: "include",
      body,
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new ApiError(
        problem?.message ?? "That file could not be read.",
        response.status,
      );
    }

    return response.json() as Promise<AiAttachment>;
  },

  detach: (id: string) =>
    apiFetch<void>(`/ai/attachments/${id}`, { method: "DELETE" }),

  /**
   * Stages the file's rows on the import screen, where they can be reviewed.
   *
   * With a plan, the columns and the account arrive already chosen, so the
   * person lands on the row-by-row check rather than a mapping form. Without
   * one, exactly as before. Either way nothing is in the books until they
   * press Import on that screen.
   */
  sendToImport: (id: string, plan?: AiImportPlan | null) =>
    apiFetch<{ batchId: string; alreadyStaged: boolean; mapped?: boolean }>(
      `/ai/attachments/${id}/to-import`,
      { method: "POST", ...json({ plan: plan ?? null }) },
    ),

  /**
   * A batch, saved one record at a time through `save` above.
   *
   * Deliberately a loop over the ordinary create, not a bulk endpoint. Every
   * row gets the same permission check, the same Zod schema and its own audit
   * row, and there is no second way into the database that would have to be
   * secured all over again. It costs seventeen requests, which nobody notices.
   *
   * It does not stop at the first failure. One row with a malformed email
   * should not strand the sixteen behind it — each result comes back on its
   * own, and the table says which row said what.
   */
  saveMany: async (
    target: AiTarget,
    rows: Array<Record<string, unknown>>,
    onProgress?: (done: number) => void,
  ): Promise<Array<{ ok: true; refNo?: string } | { ok: false; error: string }>> => {
    const results: Array<{ ok: true; refNo?: string } | { ok: false; error: string }> = [];

    for (const [index, row] of rows.entries()) {
      try {
        const created = await aiApi.save(target, row);
        results.push({ ok: true, refNo: created.refNo });
      } catch (caught) {
        results.push({
          ok: false,
          error:
            caught instanceof ApiError
              ? [
                  caught.message,
                  ...Object.entries(caught.fieldErrors ?? {}).map(
                    ([field, messages]) => `${field}: ${messages[0]}`,
                  ),
                ].join(" — ")
              : "Could not save that one.",
        });
      }
      onProgress?.(index + 1);
    }

    return results;
  },

  /**
   * Tells the server what was changed before saving, so it reads better next
   * time.
   *
   * Deliberately fire-and-forget: the save has already succeeded by the time
   * this is called, and nothing about it should be able to fail, block, or
   * appear to fail because a lesson could not be filed.
   */
  learn: (chatId: string, target: AiTarget, confirmed: Record<string, unknown>) =>
    apiFetch<{ recorded: number }>("/ai/learn", {
      method: "POST",
      ...json({ chatId, target, confirmed }),
    }).catch(() => ({ recorded: 0 })),

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

    return apiFetch<{ refNo?: string; id: string }>(
      AI_TARGET_ENDPOINT[target],
      {
        method: "POST",
        ...json(body),
      },
    );
  },
};
