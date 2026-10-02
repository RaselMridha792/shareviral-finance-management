import {
  AI_FIRST_PAYMENT_NOTE,
  AI_TARGET_ENDPOINT,
  type AiAttachment,
  type AiAvailability,
  type AiChat,
  type AiChatSummary,
  type AiImportPlan,
  type AiInstructions,
  type AiKeyResult,
  type AiKnowledge,
  type AiMistake,
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

  /**
   * The owner's instructions for the assistant: plain text, one rule a
   * line. Super Admin's to read and to save; the API refuses anybody else.
   */
  instructions: () =>
    apiFetch<AiInstructions>("/ai/instructions", { cache: "no-store" }),

  setInstructions: (instructions: string) =>
    apiFetch<AiInstructions>("/ai/instructions", {
      method: "PUT",
      ...json({ instructions }),
    }),

  turn: (request: AiIntakeRequest) =>
    apiFetch<AiIntakeReply>("/ai/turn", { method: "POST", ...json(request) }),

  /**
   * "This was wrong", on the answer the conversation ended on. Only the
   * reason travels: what was asked and answered is read from the
   * conversation on the server.
   */
  feedback: (chatId: string, reason: string) =>
    apiFetch<{ recorded: true }>("/ai/feedback", {
      method: "POST",
      ...json({ chatId, reason }),
    }),

  /** The Assistant's mistakes, newest first. Super Admin's, as the rules are. */
  mistakes: () => apiFetch<AiMistake[]>("/ai/mistakes", { cache: "no-store" }),

  /** One line added to the owner's instructions; the instructions come back. */
  makeRule: (id: string, rule: string) =>
    apiFetch<AiInstructions>(`/ai/mistakes/${id}/rule`, {
      method: "POST",
      ...json({ rule }),
    }),

  forgetMistake: (id: string) =>
    apiFetch<void>(`/ai/mistakes/${id}`, { method: "DELETE" }),

  /** The map of the app the Assistant is given. */
  knowledge: () =>
    apiFetch<AiKnowledge>("/ai/knowledge", { cache: "no-store" }),

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
  ): Promise<
    Array<{ ok: true; refNo?: string } | { ok: false; error: string }>
  > => {
    const results: Array<
      { ok: true; refNo?: string } | { ok: false; error: string }
    > = [];

    for (const [index, row] of rows.entries()) {
      try {
        const created = await aiApi.save(target, row);
        // A plan whose first payment was refused is saved, and is not done.
        results.push(
          created.warning
            ? { ok: false, error: created.warning }
            : { ok: true, refNo: created.refNo },
        );
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
  learn: (
    chatId: string,
    target: AiTarget,
    confirmed: Record<string, unknown>,
  ) =>
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
  save: async (
    target: AiTarget,
    draft: Record<string, unknown>,
  ): Promise<{ refNo?: string; id: string; warning?: string }> => {
    const resolved = await apiFetch<Record<string, unknown>>("/ai/resolve", {
      method: "POST",
      ...json({ draft }),
    });

    const body: Record<string, unknown> = { ...resolved };
    if (target === "transaction_in" || target === "transaction_out") {
      body.direction = target === "transaction_in" ? "in" : "out";
      body.createdVia = "ai_intake";
    }

    /*
     * A renewal is posted to its plan: the Renew drawer's own request. The
     * plan the draft named is the address, not part of the body, and the
     * renewal date moves on as it does from the drawer.
     */
    if (target === "subscription_payment") {
      const { subscriptionId, ...payment } = body;
      if (typeof subscriptionId !== "string") {
        throw new ApiError("Say which plan this renewal is for.", 400);
      }
      return apiFetch<{ refNo?: string; id: string }>(
        AI_TARGET_ENDPOINT[target].replace(":id", subscriptionId),
        { method: "POST", ...json({ ...payment, advanceRenewal: true }) },
      );
    }

    const created = await apiFetch<{ refNo?: string; id: string }>(
      AI_TARGET_ENDPOINT[target],
      {
        method: "POST",
        ...json(body),
      },
    );

    /*
     * A new plan takes its first payment out of its account, as the Add
     * subscription form does: the same second request, with the same note.
     * Without it the plan would be on the page and the money nowhere — the
     * owner's first complaint about that form, the other way round.
     *
     * The plan is saved by now. If the payment is refused — a locked month,
     * an account that does not hold it — that is said, with the form's own
     * way out, and the plan is not reported as lost.
     */
    if (target === "subscription") {
      try {
        const paid = await apiFetch<{ refNo?: string; id: string }>(
          `/subscriptions/${created.id}/pay`,
          {
            method: "POST",
            ...json({
              txnDate: body.startDate,
              note: AI_FIRST_PAYMENT_NOTE,
              // The renewal date is already the first one after today.
              advanceRenewal: false,
            }),
          },
        );
        return { id: created.id, refNo: paid.refNo };
      } catch (caught) {
        return {
          id: created.id,
          warning: `The plan is saved, but its first payment did not go through: ${
            caught instanceof ApiError ? caught.message : "try it again"
          } Use Renew on its row to take the money out.`,
        };
      }
    }

    return created;
  },
};
