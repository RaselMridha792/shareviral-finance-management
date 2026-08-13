import { z } from "zod";

/**
 * The assistant that fills in a form.
 *
 * It is deliberately not an agent. It holds no tools, touches no database, and
 * cannot save anything. Each turn it reads what has been said so far and
 * returns the same shape: which kind of record this is, the fields it has
 * understood, what is still missing, and the single next question to ask.
 *
 * When nothing is missing the app renders an ordinary, editable form filled in
 * with those values. Pressing Save calls the same endpoint the manual form
 * calls, so permissions, validation and the audit trail all apply exactly as
 * they would have. There is no path by which talking to the assistant achieves
 * something typing could not.
 */

export const AI_TARGETS = [
  "transaction_out",
  "transaction_in",
  "vendor",
  "team_member",
  "tds_deposit",
] as const;
export const aiTargetSchema = z.enum(AI_TARGETS);
export type AiTarget = z.infer<typeof aiTargetSchema>;

export const AI_TARGET_LABELS: Record<AiTarget, string> = {
  transaction_out: "Money going out",
  transaction_in: "Money coming in",
  vendor: "A vendor",
  team_member: "Someone on the team",
  tds_deposit: "A TDS challan",
};

/** Which permission a target needs, so the app refuses before the model asks. */
export const AI_TARGET_PERMISSION: Record<AiTarget, string> = {
  transaction_out: "transactions.write",
  transaction_in: "transactions.write",
  vendor: "vendors.write",
  team_member: "team.write",
  tds_deposit: "tds.write",
};

/** Where a confirmed draft is posted. The same endpoint the form uses. */
export const AI_TARGET_ENDPOINT: Record<AiTarget, string> = {
  transaction_out: "/transactions",
  transaction_in: "/transactions",
  vendor: "/vendors",
  team_member: "/team-members",
  tds_deposit: "/tds/deposits",
};

/* -------------------------------------------------------------------------- */
/*  What the assistant may see, and which model answers                        */
/* -------------------------------------------------------------------------- */

/**
 * How much of the books the assistant may read.
 *
 * This is the honest knob. Letting it answer "how much did we spend on rent in
 * August" means the answer — real figures from the ledger — is sent to
 * Anthropic to be turned into a sentence. That may be entirely fine, and it may
 * not be; it is not a decision to make silently on somebody's behalf.
 */
export const AI_DATA_ACCESS = ["off", "names_only", "full"] as const;
export const aiDataAccessSchema = z.enum(AI_DATA_ACCESS);
export type AiDataAccess = z.infer<typeof aiDataAccessSchema>;

export const AI_DATA_ACCESS_LABELS: Record<AiDataAccess, string> = {
  off: "Nothing — the assistant is switched off",
  names_only: "Names only — it can fill in forms, not answer questions",
  full: "Full — it can also look up figures and answer questions",
};

export const AI_DATA_ACCESS_DETAIL: Record<AiDataAccess, string> = {
  off: "No request is made and no data leaves.",
  names_only:
    "What is sent: the message typed, and the names of your categories, accounts and vendors so it can pick a real one. No amounts, no balances, no salaries, nothing from the ledger.",
  full: "As above, plus the results of any lookup it makes — real dates, amounts, descriptions and balances from your books. It can only reach what the person asking could reach by clicking; it can never reach pay.",
};

export const AI_MODELS = [
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-haiku-4-5-20251001",
] as const;
export const aiModelSchema = z.enum(AI_MODELS);
export type AiModel = z.infer<typeof aiModelSchema>;

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  "claude-sonnet-5": "Sonnet 5 — the sensible default",
  "claude-opus-5": "Opus 5 — the most capable, and the most expensive",
  "claude-haiku-4-5-20251001": "Haiku 4.5 — fastest and cheapest",
};

/** For the picker in the composer, where there is room for a name and no more. */
export const AI_MODEL_SHORT: Record<AiModel, string> = {
  "claude-sonnet-5": "Sonnet 5",
  "claude-opus-5": "Opus 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};

export const AI_MODEL_DETAIL: Record<AiModel, string> = {
  "claude-sonnet-5":
    "Ample for filling in a form and answering a question about the books.",
  "claude-opus-5":
    "Worth it only if you find Sonnet is misreading how people here actually write.",
  "claude-haiku-4-5-20251001":
    "Noticeably quicker and cheaper. Fine for straightforward entries; less reliable on a long, rambling one.",
};

export const updateAiSettingsSchema = z
  .strictObject({
    model: aiModelSchema.optional(),
    dataAccess: aiDataAccessSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

export const aiMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const aiIntakeRequestSchema = z.strictObject({
  messages: z.array(aiMessageSchema).min(1).max(40),
  /** Carried between turns so the model does not have to re-derive it. */
  target: aiTargetSchema.optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
  /**
   * Which conversation this belongs to. Omitted on the first message, when the
   * server starts one and returns its id.
   */
  chatId: z.string().uuid().optional(),
});
export type AiIntakeRequest = z.infer<typeof aiIntakeRequestSchema>;

/* -------------------------------------------------------------------------- */
/*  Saved conversations                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A conversation belongs to the person who had it — nobody else, Super Admin
 * included, can open it.
 *
 * A transcript can hold real figures, so it is not shared reading material.
 * That is also why it is stored on the server rather than in the browser: it
 * follows the person to another machine, and it disappears the moment they
 * delete it rather than sitting in a local store nobody remembers.
 */
export type AiChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type AiChat = AiChatSummary & {
  messages: AiMessage[];
  /** The last draft, so reopening a conversation resumes where it stopped. */
  reply: AiIntakeReply | null;
};

/** The first thing said, trimmed to something readable in a list. */
export function chatTitleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 48) return line || "New chat";
  return line.slice(0, 47).trimEnd() + "…";
}

/** What one turn produces. Data only — nothing here causes a write. */
export type AiIntakeReply = {
  /** The conversation this turn was filed under, new or continuing. */
  chatId?: string;
  target: AiTarget | null;
  /** Understood so far, in the shape the real endpoint expects. */
  draft: Record<string, unknown>;
  /** Required fields still unanswered. Empty means the draft is complete. */
  missingFields: string[];
  /** The one question to ask next, or null when nothing is missing. */
  nextQuestion: string | null;
  /** A sentence summarising the draft, for the confirmation step. */
  summary: string | null;
  /** Shown when the model could not tell what is being recorded. */
  clarification: string | null;
};

export type AiAvailability = {
  configured: boolean;
  /** Why it is unavailable, in words a person can act on. */
  reason: string | null;
  /**
   * "sk-ant-…LTa4" when a key is stored — enough to recognise which key it is,
   * never enough to use. The key itself never leaves the server.
   */
  keyHint?: string | null;
  /** When it was set, and by whom, so a shared credential has an owner. */
  setAt?: string | null;
  setBy?: string | null;
  /** True when it came from the environment rather than Settings. */
  fromEnvironment?: boolean;
  model?: AiModel;
  dataAccess?: AiDataAccess;
};

/**
 * Setting the key.
 *
 * Checked against Anthropic before it is saved: a typo that is only discovered
 * the first time somebody tries to use the assistant is a bad trade for one
 * cheap request now.
 */
export const setAiKeySchema = z.strictObject({
  apiKey: z
    .string()
    .trim()
    .min(20, "That is too short to be an API key")
    .max(200)
    .refine(
      (v) => v.startsWith("sk-ant-"),
      "An Anthropic key starts with sk-ant-",
    ),
});
export type SetAiKeyInput = z.infer<typeof setAiKeySchema>;

export type AiKeyResult = {
  saved: boolean;
  keyHint: string | null;
  /** What Anthropic said, when it refused. */
  message: string | null;
};
