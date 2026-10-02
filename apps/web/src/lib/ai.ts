import {
  type AiAttachment,
  type AiAvailability,
  type AiChat,
  type AiChatSummary,
  type AiConfirmResult,
  type AiImportPlan,
  type AiInstructions,
  type AiKeyResult,
  type AiKnowledge,
  type AiMistake,
  type UpdateAiSettingsInput,
  type AiIntakeReply,
  type AiIntakeRequest,
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

  /**
   * A Google Sheet, Doc or Drive file, read by its link (A3). The server
   * reads it with the service account and keeps it as an attachment, the
   * same shape an upload comes back as. A Sheet whose link names no tab
   * comes back as every tab, an attachment each, in its order (A3b).
   */
  attachLink: (url: string) =>
    apiFetch<AiAttachment[]>("/ai/attachments/link", {
      method: "POST",
      ...json({ url }),
    }),

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
   * Confirm and save (A4): the draft card's boxes as the person left them.
   *
   * The server reads which kind of record it is from the conversation,
   * checks it again and saves it through the record's own service, as this
   * person; what comes back says what was saved and where it shows. What
   * was changed on the card is kept as a lesson there too.
   */
  confirm: (chatId: string, draft: Record<string, string>) =>
    apiFetch<AiConfirmResult>("/ai/confirm", {
      method: "POST",
      ...json({ chatId, draft }),
    }),

  /**
   * One row of a table of drafts, by its number. Its values are read from
   * the conversation, not sent: the row saved is the row that was shown.
   */
  confirmRow: (chatId: string, row: number) =>
    apiFetch<AiConfirmResult>("/ai/confirm", {
      method: "POST",
      ...json({ chatId, row }),
    }),
};
