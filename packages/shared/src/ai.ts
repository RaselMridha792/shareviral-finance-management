import { z } from "zod";

import type { Permission } from "./permissions.ts";

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

/**
 * `transfer` (2 Oct 2026) is money moved between two of our own accounts.
 *
 * It was missing, and the owner found out on the live site: asked to move a
 * lakh from one of our accounts to another, the assistant had nowhere to put
 * it, filed it as money going out, and produced a draft with no category that
 * could not be saved. A transfer has no category and nobody was paid; it is
 * the Money Transfer form's record, posted to that form's endpoint.
 *
 * `subscription` and `subscription_payment` (2 Oct 2026) are the two records
 * of AI tools and subscriptions: a new plan, and a plan's renewal. They were
 * missing too, and the owner found out the same way: told to buy an AI
 * subscription, the assistant recorded a plain payment. All transactions
 * showed it; the AI tools and subscriptions page showed nothing, because that
 * page lists plans and a plain payment is not one. A plan is the Add
 * subscription form's record, with its first payment taken as that form
 * takes it; a renewal is the Renew drawer's.
 */
export const AI_TARGETS = [
  "transaction_out",
  "transaction_in",
  "transfer",
  "subscription",
  "subscription_payment",
  "vendor",
  "team_member",
  "tds_deposit",
] as const;
export const aiTargetSchema = z.enum(AI_TARGETS);
export type AiTarget = z.infer<typeof aiTargetSchema>;

export const AI_TARGET_LABELS: Record<AiTarget, string> = {
  transaction_out: "Money going out",
  transaction_in: "Money coming in",
  transfer: "Money moved between our own accounts",
  subscription: "A new plan under AI tools and subscriptions",
  subscription_payment: "A plan's renewal, under AI tools and subscriptions",
  vendor: "A vendor",
  team_member: "Someone on the team",
  tds_deposit: "A TDS challan",
};

/**
 * What a person must hold to save each kind of record: the permissions its
 * own endpoints ask for. A draft is not offered to somebody whose role could
 * not save it. A new plan needs two, because adding one takes its first
 * payment out of the account, as the form does.
 */
export const AI_TARGET_PERMISSION: Record<AiTarget, readonly Permission[]> = {
  transaction_out: ["transactions.write"],
  transaction_in: ["transactions.write"],
  transfer: ["transactions.write"],
  subscription: ["vendors.write", "transactions.write"],
  subscription_payment: ["transactions.write"],
  vendor: ["vendors.write"],
  team_member: ["team.write"],
  tds_deposit: ["tds.write"],
};

/**
 * Where a confirmed draft is posted. The same endpoint the form uses. A
 * renewal is posted to its plan, so `:id` there is the plan the draft named.
 */
export const AI_TARGET_ENDPOINT: Record<AiTarget, string> = {
  transaction_out: "/transactions",
  transaction_in: "/transactions",
  transfer: "/transactions/transfer",
  subscription: "/subscriptions",
  subscription_payment: "/subscriptions/:id/pay",
  vendor: "/vendors",
  team_member: "/team-members",
  tds_deposit: "/tds/deposits",
};

/**
 * Where a saved record shows afterwards: the screen's own name, and its
 * address. Said after a save, so the person knows where to look — the owner's
 * complaint was a record that showed on one page and not on the page it
 * belonged to. `null` is a record no screen lists.
 */
export const AI_TARGET_SHOWS_ON: Record<
  AiTarget,
  { name: string; href: string } | null
> = {
  transaction_out: { name: "All transactions", href: "/transactions" },
  transaction_in: { name: "All transactions", href: "/transactions" },
  transfer: { name: "Money Transfer", href: "/transfers" },
  subscription: { name: "AI tools and subscriptions", href: "/subscriptions" },
  subscription_payment: {
    name: "AI tools and subscriptions",
    href: "/subscriptions",
  },
  vendor: null,
  team_member: { name: "Team", href: "/team" },
  tds_deposit: { name: "TDS", href: "/tax/withholding" },
};

/**
 * The note on a new plan's first payment. The Add subscription form writes
 * the same words; a plan added through the assistant reads no differently in
 * the ledger.
 */
export const AI_FIRST_PAYMENT_NOTE =
  "First payment, recorded when the plan was added";

/**
 * The line under a draft that is ready to save. Written here, not by the
 * model (2 Oct 2026): a model's own closing sentence said "transfer record
 * korechi" about a draft nobody had saved.
 */
export const AI_DRAFT_READY_LINE =
  "Draft ready — check every line, then press Save. Nothing is recorded yet.";

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
 *
 * Gemini (2 Oct 2026) is here ON TRIAL, and none of the three has cleared
 * that bar. Google gave the project no quota for Claude, and Gemini answers on
 * the same key. The owner decided the real model is tried on the live site
 * and not locally, so no key is ever put in the local database to run the
 * test conversations with (docs/briefs/2026-10-02-assistant-powerful.md).
 * `.assistantbar.mjs` at the repository root is those conversations, kept as
 * code. If a Gemini fills in an account nobody named, take it out of this
 * list.
 *
 * The order is the order they are offered in. Of the two Google lists as its
 * latest, 3.8 Flash comes first because it is the one that is not a preview.
 * 2.5 Pro is last because Google is retiring it — see AI_MODEL_RETIRING.
 */
export const AI_MODELS = [
  "claude-opus-5",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
] as const;
export const aiModelSchema = z.enum(AI_MODELS);
export type AiModel = z.infer<typeof aiModelSchema>;

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  "claude-opus-5": "Opus 5",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
};

/** For the composer, where there is room for a name and no more. */
export const AI_MODEL_SHORT: Record<AiModel, string> = {
  "claude-opus-5": "Opus 5",
  "gemini-3.8-flash": "Gemini 3.8",
  "gemini-3.1-pro-preview": "Gemini 3.1",
  "gemini-2.5-pro": "Gemini 2.5",
};

const ON_TRIAL =
  "On trial: it has not yet been run against the test conversations that decided between the Claude models, so check the account and the amount on every draft before saving it.";

export const AI_MODEL_DETAIL: Record<AiModel, string> = {
  "claude-opus-5":
    "On the same test conversations the cheaper Claude models invented an account nobody had named; this one asked instead.",
  "gemini-3.8-flash": `Google's model, through Google Cloud only. ${ON_TRIAL}`,
  "gemini-3.1-pro-preview": `Google's model, through Google Cloud only. A preview: Google can change it or withdraw it at short notice. ${ON_TRIAL}`,
  "gemini-2.5-pro": `Google retires this model between 16 and 20 October 2026, and it stops answering then. Choose Gemini 3.8 Flash before that. ${ON_TRIAL}`,
};

/** A Gemini model is asked in Google's own way, and only through Google Cloud. */
export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

/**
 * The Gemini offered first, and what a stored Gemini that is no longer in
 * the list is read as (2 Oct 2026).
 */
export const AI_GEMINI_DEFAULT: AiModel = "gemini-3.8-flash";

/**
 * Models Google is taking away, and what to choose instead.
 *
 * Google's own pages give 2.5 Pro "no earlier than 16 October 2026" and 20
 * October 2026. After that a request for it is a 404, and the sentence the
 * person sees names the successor (gemini-errors.ts). Once it is gone, take
 * the model out of AI_MODELS: a row that still names it is then read as the
 * successor's kind — see `aiModelFrom`.
 */
export const AI_MODEL_RETIRING: Partial<
  Record<AiModel, { when: string; successor: AiModel }>
> = {
  "gemini-2.5-pro": {
    when: "between 16 and 20 October 2026",
    successor: AI_GEMINI_DEFAULT,
  },
};

/**
 * How the assistant reaches its model: an Anthropic key, or Google Cloud.
 *
 * The owner, 1 Oct 2026: Anthropic would not answer until the account's
 * identity was verified, and the owner's NID did not get through. Through
 * Google Cloud (Vertex AI) it is the same model and the same assistant; the
 * billing and the checks are Google's. The key for that is the service account
 * under Settings → Connections, which also reads shared Sheets and Docs.
 *
 * 2 Oct 2026: Google then gave the project a quota of zero for Claude, and
 * would not raise it. Gemini answers on the same project and the same key, so
 * it is offered through this provider too — see AI_MODEL_PROVIDERS.
 */
export const AI_PROVIDERS = ["anthropic", "vertex"] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic key",
  vertex: "Google Cloud",
};

export const AI_PROVIDER_DETAIL: Record<AiProvider, string> = {
  anthropic:
    "Straight to Anthropic, with the API key below. Anthropic bills it and runs its own account checks.",
  vertex:
    "Through Vertex AI, with the service account under Settings → Connections. Google bills it; the assistant is the same, with Claude or with Gemini.",
};

/**
 * Which model goes which way (2 Oct 2026).
 *
 * Claude is reached with an Anthropic key or through Google Cloud. Gemini is
 * Google's own, so it goes through Google Cloud and no other way — there is no
 * separate Gemini key here, on purpose: a free-tier key may let Google use the
 * data, and it could not read the privately shared Sheets and Docs.
 */
export const AI_MODEL_PROVIDERS: Record<AiModel, readonly AiProvider[]> = {
  "claude-opus-5": ["anthropic", "vertex"],
  "gemini-3.8-flash": ["vertex"],
  "gemini-3.1-pro-preview": ["vertex"],
  "gemini-2.5-pro": ["vertex"],
};

export function aiModelGoesWith(model: AiModel, provider: AiProvider): boolean {
  return AI_MODEL_PROVIDERS[model].includes(provider);
}

/** The models a provider can offer, in the order they are listed. */
export function aiModelsFor(provider: AiProvider): AiModel[] {
  return AI_MODELS.filter((model) => aiModelGoesWith(model, provider));
}

/**
 * What a stored model is read as, reached this way.
 *
 * The column has no check of its own, and the list above changes: a model
 * comes out when Google retires it, or when it invents. A stored Gemini that
 * is no longer listed is read as the Gemini offered first, and not as Claude.
 * Google gave this project no quota for Claude, so falling back to Claude
 * there would be an assistant that cannot answer at all.
 */
export function aiModelFrom(
  stored: string | null | undefined,
  provider: AiProvider,
): AiModel {
  const offered = AI_MODELS.find((model) => model === stored);
  if (offered && aiModelGoesWith(offered, provider)) return offered;
  if (
    stored &&
    !offered &&
    isGeminiModel(stored) &&
    aiModelGoesWith(AI_GEMINI_DEFAULT, provider)
  ) {
    return AI_GEMINI_DEFAULT;
  }
  return aiModelsFor(provider)[0];
}

/**
 * Why a model and a provider cannot be chosen together, in words.
 *
 * Asked by the service rather than written into `updateAiSettingsSchema`: a
 * change usually names one of the two, and only the service knows the stored
 * other. It also answers with this sentence as the message, where a schema
 * refusal reads "Validation failed".
 */
export function aiModelProviderProblem(
  model: AiModel,
  provider: AiProvider,
): string | null {
  if (aiModelGoesWith(model, provider)) return null;
  return `${AI_MODEL_LABELS[model]} is reached through ${AI_MODEL_PROVIDERS[
    model
  ]
    .map((way) => AI_PROVIDER_LABELS[way])
    .join(
      " or ",
    )}, not through ${AI_PROVIDER_LABELS[provider]}. Change the two together.`;
}

/* -------------------------------------------------------------------------- */
/*  Instructions for the Assistant                                             */
/* -------------------------------------------------------------------------- */

/**
 * The owner's own rules for the assistant: plain text, one rule a line
 * (2 Oct 2026).
 *
 * "Claude, ChatGPT, Gemini kena = AI tools & subscriptions." A model cannot be
 * trained by us; what it knows about this company is what the app puts in
 * front of it, and this is the part of that the owner writes. It is placed in
 * the prompt after the map of the app. A rule here can say where something
 * belongs or how it is filed. It cannot give anybody a permission: every
 * look-up and every save still runs as the person asking.
 *
 * The limit is on purpose. This text is sent with every message of every
 * conversation, and a page of rules nobody rereads is a page of rules that
 * contradict each other.
 */
export const AI_INSTRUCTIONS_MAX = 4_000;

export const setAiInstructionsSchema = z.strictObject({
  instructions: z
    .string()
    // One line ending, whichever machine it was typed on.
    .transform((text) => text.replace(/\r\n?/g, "\n").trim())
    .pipe(
      z
        .string()
        .max(
          AI_INSTRUCTIONS_MAX,
          `Keep the instructions under ${AI_INSTRUCTIONS_MAX.toLocaleString("en-US")} characters`,
        ),
    ),
});
export type SetAiInstructionsInput = z.infer<typeof setAiInstructionsSchema>;

export type AiInstructions = {
  instructions: string;
  /** When it was last saved, and by whom. Null: nobody has saved one yet. */
  setAt: string | null;
  setBy: string | null;
};

export const updateAiSettingsSchema = z
  .strictObject({
    model: aiModelSchema.optional(),
    dataAccess: aiDataAccessSchema.optional(),
    provider: aiProviderSchema.optional(),
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
  /**
   * Which part of the app the request belongs to: a key of the app's map
   * (the API's `app-map.ts`). Decided before anything is drafted, and the
   * draft's kind has to be one that part keeps.
   */
  area?: string | null;
  /**
   * The screen to open, when this is something the assistant cannot draft
   * and can only point to — or where a record of this kind is kept.
   */
  screen?: { name: string; href: string } | null;
  target: AiTarget | null;
  /** Understood so far, in the shape the real endpoint expects. */
  draft: Record<string, unknown>;
  /**
   * Fields still unanswered. Empty means the draft is complete — and that is
   * the API's finding, not the model's: every draft is put through the
   * schema its Save will use before it is sent (draft-check.ts).
   */
  missingFields: string[];
  /** The one question to ask next, or null when nothing is missing. */
  nextQuestion: string | null;
  /**
   * An answer to something that was asked — or, under a draft that is ready,
   * `AI_DRAFT_READY_LINE`. Never the model's own account of a draft.
   */
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
  /**
   * Which way Claude is reached. `keyHint` and the two beside it always
   * describe the Anthropic key, whichever is chosen — the Google one is
   * described by Settings → Connections.
   */
  provider?: AiProvider;
  /** Whether a Google Cloud key is stored, so the choice can be offered. */
  googleKeySet?: boolean;
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
