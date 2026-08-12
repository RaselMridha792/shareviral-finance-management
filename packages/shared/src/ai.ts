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
});
export type AiIntakeRequest = z.infer<typeof aiIntakeRequestSchema>;

/** What one turn produces. Data only — nothing here causes a write. */
export type AiIntakeReply = {
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
};
