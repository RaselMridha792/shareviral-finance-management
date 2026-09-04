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
/**
 * On, or off. There is no half.
 *
 * There was a middle setting — "names only" — which handed over the names of
 * accounts and categories and withheld every lookup tool. The idea was
 * caution. What it actually produced was an assistant that could see the
 * labels on the doors and nothing behind them: it could not check whether a
 * person was already on the team, whether a bill had been paid twice, or what
 * a balance was. Half a picture is where confident wrong answers come from,
 * and every one of them lands on somebody's screen looking like the truth.
 *
 * So the choice is now honest: either it can read the books or it is off.
 *
 * "Can read" still means *as the person asking*. Every lookup runs under their
 * permissions — an HR user asking about the ledger is refused exactly as they
 * would be by clicking — and pay has no tool at all, at any setting. That is
 * not a limit on the assistant's understanding; it is who is at the keyboard.
 */
export const AI_DATA_ACCESS = ["off", "full"] as const;
export const aiDataAccessSchema = z.enum(AI_DATA_ACCESS);
export type AiDataAccess = z.infer<typeof aiDataAccessSchema>;

export const AI_DATA_ACCESS_LABELS: Record<AiDataAccess, string> = {
  off: "Off — the assistant is switched off",
  full: "On — it can read the books and answer questions",
};

export const AI_DATA_ACCESS_DETAIL: Record<AiDataAccess, string> = {
  off: "No request is made and no data leaves.",
  full: "What is sent: the message typed, the names of your accounts, categories and tools, and the results of any lookup it makes — real dates, amounts, descriptions and balances. It can only reach what the person asking could reach by clicking, and it can never reach pay.",
};

/**
 * One model, deliberately.
 *
 * The three were run against the same conversations before this was narrowed.
 * The difference that mattered was not phrasing, it was invention: asked to
 * record a payment where nobody named an account, Haiku filled one in on two of
 * six — `Petty cash (demo)` once, `Standard Chartered Bank` once. Opus asked,
 * every time. A guessed account resolves to a real account and files real money
 * in the wrong place, and the entry looks perfectly ordinary afterwards.
 *
 * That is the one failure the code cannot catch, so the cheaper models are not
 * offered. A picker whose wrong option quietly misfiles money is not a saving.
 */
export const AI_MODELS = ["claude-opus-5"] as const;
export const aiModelSchema = z.enum(AI_MODELS);
export type AiModel = z.infer<typeof aiModelSchema>;

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  "claude-opus-5": "Opus 5",
};

/** For the composer, where there is room for a name and no more. */
export const AI_MODEL_SHORT: Record<AiModel, string> = {
  "claude-opus-5": "Opus 5",
};

export const AI_MODEL_DETAIL: Record<AiModel, string> = {
  "claude-opus-5":
    "The only model offered here. On the same test conversations the cheaper ones invented an account nobody had named; this one asked instead.",
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
  /**
   * Was 4,000 characters, which is about a page. People paste more than a page
   * — a block of statement lines, a list of names, a mail from the accountant
   * — and got "Validation failed" for doing the obvious thing.
   */
  content: z.string().trim().min(1).max(40_000),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const aiIntakeRequestSchema = z.strictObject({
  /**
   * The whole conversation, resent each turn.
   *
   * Was capped at forty, and the cap was a wall rather than a limit: the
   * forty-first message did not trim the oldest or warn anybody, it failed the
   * request outright, so a conversation that was going well simply stopped
   * working and the person could not tell why. Twenty exchanges is not a long
   * conversation about a set of books.
   *
   * Two hundred, and the server drops the oldest beyond that rather than
   * refusing — a trimmed opening is a smaller loss than a dead conversation.
   */
  messages: z.array(aiMessageSchema).min(1).max(200),
  /** Carried between turns so the model does not have to re-derive it. */
  target: aiTargetSchema.optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
  /**
   * Which conversation this belongs to. Omitted on the first message, when the
   * server starts one and returns its id.
   */
  chatId: z.string().uuid().optional(),
  /** A file attached to this conversation, for the assistant to read. */
  attachmentId: z.string().uuid().optional(),
});
export type AiIntakeRequest = z.infer<typeof aiIntakeRequestSchema>;

/* -------------------------------------------------------------------------- */
/*  Attaching a file                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A spreadsheet somebody wants read rather than typed.
 *
 * The arithmetic is done here, on the server, and only the result is described
 * to the model. Asking a language model to total a column of 400 figures is
 * asking for a number that looks right — the sums, ranges and counts below are
 * computed in code, so "how much is in this file" has one answer and it is the
 * correct one.
 */
export const AI_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const AI_ATTACHMENT_EXTENSIONS = [
  ".csv",
  ".tsv",
  ".txt",
  ".xlsx",
  ".xls",
  /**
   * A PDF is read by the model, not by a parser, and is transcribed into rows
   * on arrival — see `pdf-statement.ts`. From that point it is the same as a
   * spreadsheet: the same summary, the same tools, the same import screen.
   */
  ".pdf",
] as const;

/** True for a file whose table has to be read out rather than parsed. */
export function isPdfAttachment(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

export type AiAttachmentColumn = {
  name: string;
  /** How many rows have anything in this column. */
  filled: number;
  kind: "number" | "date" | "text";
  /** Set for a numeric column. Strings, because these are money. */
  total?: string;
  min?: string;
  max?: string;
  /** Set for a text column with few enough values to be worth listing. */
  distinct?: number;
  examples: string[];
  /**
   * Which way a date column was read, worked out from the whole column.
   *
   * "unknown" means nothing in it settled the question — every value's first
   * part was twelve or under — so it was read day-first and could be wrong.
   * That is worth saying rather than hiding: 05/08 is 5 August or 8 May, and
   * the difference is a transaction in the wrong month.
   */
  dateOrder?: "dmy" | "mdy" | "unknown";
};

export type AiAttachment = {
  id: string;
  name: string;
  /** Rows in the file. */
  rowCount: number;
  /** Rows kept for analysis — fewer than rowCount for a very large file. */
  storedRows: number;
  columns: AiAttachmentColumn[];
  /** The first few rows, so the person can see it read the file correctly. */
  sample: Array<Record<string, string | number | null>>;
  /** Set once the rows have been handed to the import screen. */
  importBatchId: string | null;
};

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
  /** Files attached to it, so reopening shows what was being discussed. */
  attachments: AiAttachment[];
};

/** The first thing said, trimmed to something readable in a list. */
export function chatTitleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 48) return line || "New chat";
  return line.slice(0, 47).trimEnd() + "…";
}

/**
 * Where a whole file's rows should go, worked out from the conversation.
 *
 * This is the answer to "these are all Standard Chartered, file them as office
 * expenses" for a file of two hundred rows. Drafting them one at a time
 * through the conversation would put two hundred figures past review; refusing
 * outright means the person maps every column by hand for something they have
 * already said in one sentence.
 *
 * So the assistant proposes and the import screen disposes. Nothing here
 * writes: it is staged, the mapping is applied, and the person lands on the
 * preview with every row shown, the duplicates flagged, and the batch
 * revertable after the fact. The plan only saves them the typing.
 */
export type AiImportPlan = {
  /** Which account every row in this file belongs to. */
  accountName: string;
  /** Used for rows whose own category is blank or unrecognised. */
  categoryName: string | null;
  /** The file's own heading → a field of ours. Anything left out is ignored. */
  columnMap: Record<string, string | null>;
  /** How this file writes dates, when the rows make it plain. */
  dateFormat: "dmy" | "mdy" | "ymd" | "auto" | null;
  /** For a file with one amount column and nothing to say which way it went. */
  assumeDirection: "in" | "out" | null;
  /**
   * The rate the whole file is read at, in taka per dollar.
   *
   * Asked for, never guessed — every ledger row in this app states a rate, and
   * a batch that writes two hundred of them states one two hundred times.
   */
  usdRate: string | null;
  /** One line naming what is about to be staged, for the button beside it. */
  note: string | null;
};

/**
 * Many records of the same kind, proposed together.
 *
 * The reply carried exactly one draft, and that shape was the reason a
 * perfectly reasonable request failed: handed a sheet of seventeen staff and
 * asked to add them, the assistant had no way to answer. It could describe
 * them, and it could draft one. Seventeen conversations is not an answer, so it
 * reached for the import screen instead — which only takes transactions — and
 * the whole thing ended in seventeen errors.
 *
 * The rows are ordinary drafts, the same shape the single draft has and
 * validated by the same rules. What is deliberately NOT here is a save: the
 * batch is reviewed as a table, any row can be dropped, and confirming it
 * posts each row to the record's own endpoint one at a time. Seventeen
 * ordinary creates, seventeen permission checks, seventeen audit rows — no
 * bulk path into the database, because a bulk path is a second way in that has
 * to be secured all over again.
 */
export type AiBatch = {
  target: AiTarget;
  /** One draft per record, in the order the file had them. */
  rows: Array<Record<string, unknown>>;
  /** One line naming what this is, for the heading above the table. */
  note: string | null;
};

/** More than this in one go belongs on the import screen, not in a chat. */
export const AI_BATCH_MAX_ROWS = 100;

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
  /** Set only when a whole attached file is ready to be staged. */
  importPlan?: AiImportPlan | null;
  /** Set when many records of one kind were understood at once. */
  batch?: AiBatch | null;
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
