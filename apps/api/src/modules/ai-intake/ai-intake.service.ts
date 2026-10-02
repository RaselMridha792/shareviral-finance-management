import Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AI_BATCH_MAX_ROWS,
  AI_DRAFT_READY_LINE,
  AI_INSTRUCTIONS_MAX,
  AI_PROVIDER_LABELS,
  AI_TARGETS,
  AI_TARGET_LABELS,
  AI_TARGET_PERMISSION,
  BILLING_CYCLE_LABELS,
  aiModelFrom,
  aiModelProviderProblem,
  hasPermission,
  isGeminiModel,
  payableUsd,
  todayInDhaka,
  type AiAvailability,
  type BillingCycle,
  type AiBatch,
  type AiIntakeReply,
  type AiImportPlan,
  type AiFeedbackInput,
  type AiInstructions,
  type AiKnowledge,
  type AiMistake,
  type AiIntakeRequest,
  type AiDataAccess,
  type AiKeyResult,
  type AiMessage,
  type AiModel,
  type AiProvider,
  type AiTarget,
  type MakeAiRuleInput,
  type SetAiInstructionsInput,
  type UpdateAiSettingsInput,
} from "@finance/shared";
import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { AuditService } from "../../common/audit/audit.service";
import {
  AI_ATTACHMENT_TOOL_NAMES,
  AiAttachmentsService,
  attachmentToolsFor,
} from "./ai-attachments.service";
import { AiChatsService } from "./ai-chats.service";
import { AiToolsService } from "./ai-tools";
import { explainClaudeError } from "./claude-errors";
import { geminiModel } from "./gemini";
import { GeminiError, explainGeminiError } from "./gemini-errors";
import {
  claudeModel,
  type ModelCallResult,
  type ModelTool,
  type TurnModel,
} from "./model-turn";
import {
  geminiClient,
  openServiceAccount,
  vertexClient,
  type ServiceAccount,
} from "../connections/google";
import {
  APP_MAP,
  APP_PART_KEYS,
  fieldsOf,
  partOf,
  partsDrafting,
  renderAppMap,
  screenOf,
} from "./app-map";
import {
  NAME_FIELDS,
  allFieldReferences,
  pairedFields,
  type NameField,
} from "./field-reference";
import {
  askFor,
  bareName,
  categoryLabels,
  categoryMatches,
  checkDraft,
  claimsItIsDone,
  knowsField,
  nameOf,
  namesIn,
  planLabels,
  plansNamed,
  tidyDraft,
  underHeading,
  type NameMatch,
  type NameMatches,
  type PlanOnFile,
} from "./draft-check";
import {
  areaOf,
  claimOn,
  planNamedIn,
  refusalOf,
  tableRefusalOf,
  type Refusal,
  type RouteContext,
} from "./routing";
import { renewalInMonth } from "../transactions/renewal-in-month";
import {
  CORRECTION_PERMISSION,
  describeReply,
  diffDraft,
  maskDigits,
  proposedRule,
  renderCorrections,
  renderReplyMistakes,
} from "./corrections";
import { readPdfStatement } from "./pdf-statement";
import {
  TRANSACTION_FIELDS,
  type MappingInput,
} from "../imports/imports.schemas";
import type { RawRow } from "../imports/row-parser";
import { hint, open, seal } from "../../common/crypto/secret-box";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  accounts,
  aiCorrections,
  appSettings,
  categories,
  subscriptions,
  users,
} from "../../db/schema";

/** A plan, with what a renewal's draft is filled from. */
type PlanRow = PlanOnFile & {
  billingCycle: string;
  costUsd: string;
  chargeUsd: string | null;
  usdRate: string | null;
  accountId: string | null;
  accountName: string | null;
  accountCurrency: string | null;
};

/** Used to check a key before the settings row is known to be readable. */
const DEFAULT_MODEL: AiModel = "claude-opus-5";

/**
 * How many times the model may look something up before it has to answer.
 *
 * Was four, chosen when a lookup was a rarity. Four is two facts and a
 * comparison, and a real question is often more than that — "which of these
 * seventeen people are already on the team, and has anybody been paid twice
 * this month" is a dozen before it is an answer. Running out mid-thought does
 * not produce "I could not check"; it produces an answer written from what it
 * managed to see, which is the failure this whole file keeps trying to prevent.
 *
 * Still bounded, because a confused loop must end. Twelve, and the last round
 * forces an answer.
 */
const MAX_LOOKUPS = 12;

/**
 * Room to answer in.
 *
 * Was 1,500, which is fine for one drafted payment and far too small for
 * anything else — and on this model `max_tokens` caps thinking *and* the reply
 * together, so a hard question could spend its budget reasoning and get cut
 * off mid-sentence. It is a ceiling, not a bill: a short answer still costs
 * what a short answer costs.
 */
const MAX_ANSWER_TOKENS = 8_000;

/**
 * Gemini's requests: tried three times in all on a busy or failing Google,
 * as the Anthropic client does on its own, and given up on after ten minutes
 * — a long statement is read for most of that.
 */
const GEMINI_TURN = { attempts: 3, timeout: 600_000 };

/*
 * What is said in place of a model's sentence that claimed something had been
 * recorded. Nothing is, until a person presses a button — see `settle`.
 */
const NOTHING_RECORDED_LINE =
  "Nothing has been recorded. I can only draft an entry for you to check and save — tell me what to record.";
const BATCH_LINE =
  "Check every row in the table, then save. Nothing is recorded yet.";
const PLAN_LINE =
  "Ready to stage. Send to Import shows every row before anything is recorded.";

@Injectable()
export class AiIntakeService {
  private readonly log = new Logger(AiIntakeService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly tools: AiToolsService,
    private readonly chats: AiChatsService,
    private readonly attachments: AiAttachmentsService,
  ) {}

  /**
   * The key: from Settings if a Super Admin has entered one, otherwise from
   * the environment.
   *
   * Settings wins on purpose — the point of storing it is that switching the
   * assistant on does not need a redeploy. The environment stays as a fallback
   * for an operator who would rather keep credentials out of the database.
   */
  private async storedKey(): Promise<{
    key: string | null;
    fromEnvironment: boolean;
    setAt: Date | null;
    setBy: string | null;
    model: AiModel;
    dataAccess: AiDataAccess;
    /** Which way Claude is reached, and — for Google — with what, and where. */
    provider: AiProvider;
    google: ServiceAccount | null;
    region: string;
    /** The owner's own rules for the assistant. Empty when there are none. */
    instructions: string;
  }> {
    const [row] = await this.db.client
      .select({
        sealed: appSettings.anthropicApiKey,
        setAt: appSettings.anthropicKeySetAt,
        setBy: users.fullName,
        model: appSettings.aiModel,
        dataAccess: appSettings.aiDataAccess,
        provider: appSettings.aiProvider,
        google: appSettings.googleServiceAccount,
        region: appSettings.vertexRegion,
        instructions: appSettings.aiInstructions,
      })
      .from(appSettings)
      .leftJoin(users, eq(appSettings.anthropicKeySetBy, users.id))
      .where(eq(appSettings.id, 1))
      .limit(1);

    const dataAccess = (row?.dataAccess ?? "full") as AiDataAccess;
    const provider: AiProvider =
      row?.provider === "vertex" ? "vertex" : "anthropic";
    // A model this app does not offer, or one that cannot be reached this way
    // (the column has no check of its own), is read as one that can answer.
    const model = aiModelFrom(row?.model, provider);
    const route = {
      provider,
      google: openServiceAccount(row?.google),
      region: row?.region || "global",
      instructions: row?.instructions ?? "",
    };

    const fromSettings = open(row?.sealed);
    if (fromSettings) {
      return {
        key: fromSettings,
        fromEnvironment: false,
        setAt: row?.setAt ?? null,
        setBy: row?.setBy ?? null,
        model,
        dataAccess,
        ...route,
      };
    }

    return {
      key: process.env.ANTHROPIC_API_KEY ?? null,
      fromEnvironment: Boolean(process.env.ANTHROPIC_API_KEY),
      setAt: null,
      setBy: null,
      model,
      dataAccess,
      ...route,
    };
  }

  /** Model, data access and the way to Claude. No key is touched here. */
  async updateSettings(input: UpdateAiSettingsInput, actor: AuthenticatedUser) {
    const stored = await this.storedKey();

    // Google Cloud with no Google key would switch the assistant off for
    // everybody on one click. The screen does not offer it; this is the rule.
    if (input.provider === "vertex" && !stored.google) {
      throw new BadRequestException(
        "Add the Google Cloud key under Settings → Connections first.",
      );
    }

    // Gemini through an Anthropic key is not a thing that exists. Whichever
    // of the two was not sent is the stored one, so the row never holds a
    // pair nothing could answer.
    const problem = aiModelProviderProblem(
      input.model ?? stored.model,
      input.provider ?? stored.provider,
    );
    if (problem) throw new BadRequestException(problem);

    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary:
        "Changed the assistant's " +
        [
          input.model ? "model to " + input.model : null,
          input.dataAccess ? "data access to " + input.dataAccess : null,
          input.provider
            ? "way to the model to " + AI_PROVIDER_LABELS[input.provider]
            : null,
        ]
          .filter(Boolean)
          .join(" and "),
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({
            model: appSettings.aiModel,
            dataAccess: appSettings.aiDataAccess,
            provider: appSettings.aiProvider,
          })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            ...(input.model ? { aiModel: input.model } : {}),
            ...(input.dataAccess ? { aiDataAccess: input.dataAccess } : {}),
            ...(input.provider ? { aiProvider: input.provider } : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return this.availability();
  }

  /**
   * The owner's instructions for the assistant, for the screen that edits
   * them: the text, and when and by whom it was last saved.
   */
  async instructions(): Promise<AiInstructions> {
    const [row] = await this.db.client
      .select({
        instructions: appSettings.aiInstructions,
        setAt: appSettings.aiInstructionsSetAt,
        setBy: users.fullName,
      })
      .from(appSettings)
      .leftJoin(users, eq(appSettings.aiInstructionsSetBy, users.id))
      .where(eq(appSettings.id, 1))
      .limit(1);

    return {
      instructions: row?.instructions ?? "",
      setAt: row?.setAt ? row.setAt.toISOString() : null,
      setBy: row?.setBy ?? null,
    };
  }

  /**
   * Saves them. The whole text each time, and an empty one is a real answer:
   * no rules.
   *
   * Through the audit log like every other change to Settings, with the text
   * before and after — a rule changes what the assistant drafts for
   * everybody, so who changed it and from what is worth being able to read
   * back. The text is the owner's and holds no key or figure to redact.
   */
  async setInstructions(
    input: SetAiInstructionsInput,
    actor: AuthenticatedUser,
  ): Promise<AiInstructions> {
    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: input.instructions
        ? "Changed the instructions for the Assistant"
        : "Cleared the instructions for the Assistant",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ instructions: appSettings.aiInstructions })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            aiInstructions: input.instructions,
            aiInstructionsSetAt: new Date(),
            aiInstructionsSetBy: actor.id,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return this.instructions();
  }

  async availability(): Promise<AiAvailability> {
    const stored = await this.storedKey();
    const route = {
      provider: stored.provider,
      googleKeySet: Boolean(stored.google),
    };

    // The Anthropic key's own description, whichever way Claude is reached:
    // the Assistant settings still show that key, and may switch back to it.
    const anthropicKey = stored.key
      ? {
          keyHint: hint(stored.key),
          setAt: stored.setAt ? stored.setAt.toISOString() : null,
          setBy: stored.setBy,
          fromEnvironment: stored.fromEnvironment,
        }
      : { keyHint: null, setAt: null, setBy: null, fromEnvironment: false };

    const unavailable =
      stored.provider === "vertex"
        ? stored.google
          ? null
          : "The assistant is set to reach Claude through Google Cloud, and no Google Cloud key has been added. A Super Admin can add one under Settings → Connections. Everything the assistant would do can be done on the ordinary forms."
        : stored.key
          ? null
          : "No API key has been set, so the assistant cannot run. A Super Admin can add one under Settings. Everything the assistant would do can be done on the ordinary forms.";

    if (unavailable) {
      return {
        configured: false,
        reason: unavailable,
        ...anthropicKey,
        model: stored.model,
        dataAccess: "off",
        ...route,
      };
    }

    return {
      configured: true,
      reason: null,
      ...anthropicKey,
      model: stored.model,
      dataAccess: stored.dataAccess,
      ...route,
    };
  }

  /**
   * Saves the key — after checking that it works.
   *
   * One cheap request now beats discovering a typo the first time somebody
   * tries to use the assistant, which reads as the feature being broken rather
   * than the key being wrong.
   */
  async setKey(apiKey: string, actor: AuthenticatedUser): Promise<AiKeyResult> {
    try {
      await new Anthropic({ apiKey }).messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (error) {
      const message =
        error instanceof Anthropic.APIError
          ? error.status === 401
            ? "Anthropic rejected that key. Check it was copied whole, with no space at either end."
            : error.status === 429
              ? "That key is over its rate limit, or the account has no credit left."
              : "Anthropic said: " + error.message
          : "Could not reach Anthropic to check the key. Try again in a moment.";

      // Deliberately not saved. A key that does not work is worse than none:
      // the screen would say the assistant is on and every turn would fail.
      return { saved: false, keyHint: null, message };
    }

    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary:
        "Set the Anthropic API key for the assistant (" + hint(apiKey) + ")",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ setAt: appSettings.anthropicKeySetAt })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            anthropicApiKey: seal(apiKey),
            anthropicKeySetAt: new Date(),
            anthropicKeySetBy: actor.id,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return { saved: true, keyHint: hint(apiKey), message: null };
  }

  async clearKey(actor: AuthenticatedUser): Promise<AiKeyResult> {
    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Removed the Anthropic API key — the assistant is switched off",
      module: "settings",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            anthropicApiKey: null,
            anthropicKeySetAt: null,
            anthropicKeySetBy: null,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
      },
    });

    return { saved: true, keyHint: null, message: null };
  }

  /**
   * One turn. Reads the conversation, returns the next question — or a
   * complete draft.
   *
   * The model is given **no tools**: it cannot read the database, cannot write
   * to it, and cannot cause anything to happen. It receives a list of the
   * categories, accounts and vendors that exist so it can name a real one, and
   * it returns JSON. Everything after that is the app's own code.
   */
  /**
   * One turn: look things up if needed, then answer or draft.
   *
   * The loop is bounded and every lookup runs as the person who asked — see
   * ai-tools.ts. The model is never given a write tool of any kind; the only
   * way anything reaches the books is a person pressing Save on a filled-in
   * form afterwards.
   */
  async turn(
    input: AiIntakeRequest,
    actor: AuthenticatedUser,
  ): Promise<AiIntakeReply> {
    /**
     * Anything Anthropic refuses, said in words rather than as a 500.
     *
     * `setKey` has translated these since the beginning; the turn itself never
     * did, so every refusal from their end — an unverified account, a spent
     * balance, a rate limit — reached the person as "Internal server error".
     * That reads as *this app is broken*, and sends them looking in exactly
     * the wrong place. The cause is nearly always something they can fix in a
     * couple of minutes, and only if they are told what it is.
     *
     * Through Google Cloud the same holds, in Google's terms — see
     * claude-errors.ts.
     */
    const reply = await this.think(input, actor).catch(
      async (error: unknown) => {
        const { provider, model, region } = await this.storedKey();

        if (error instanceof GeminiError) {
          // Google's own words, every time, whether or not they could be
          // explained. `scrub` has already cut anything secret out of them.
          this.log.warn(
            `Google Cloud refused a Gemini turn (${error.status ?? error.kind}): ${error.message}`,
          );
          throw new ServiceUnavailableException(
            `${explainGeminiError(error, { model, region })} The ordinary forms all still work.`,
          );
        }

        const detail = explainClaudeError(error, provider, { model, region });
        if (!detail || !(error instanceof Anthropic.APIError)) throw error;

        // The message and the status only: neither carries the key.
        this.log.warn(
          `${provider === "vertex" ? "Google Cloud" : "Anthropic"} refused a turn (${error.status ?? "no status"}): ${error.message}`,
        );
        throw new ServiceUnavailableException(
          `${detail} The ordinary forms all still work.`,
        );
      },
    );

    // Written after the answer, not before: a turn that failed leaves no
    // half-conversation in the history, and a question that was never answered
    // is not worth keeping.
    const said = reply.nextQuestion ?? reply.clarification ?? reply.summary;
    const messages: AiMessage[] = said
      ? [...input.messages, { role: "assistant", content: said }]
      : [...input.messages];

    const chatId = await this.chats
      .record(input.chatId, messages, reply, actor)
      .catch((error: unknown) => {
        // History is a convenience. Losing it must never cost somebody the
        // answer they just waited for.
        this.log.warn(`Could not save the conversation: ${String(error)}`);
        return input.chatId;
      });

    // The file was attached before the conversation existed, so this is the
    // first moment the two can be tied together.
    if (chatId && input.attachmentId) {
      await this.attachments
        .attachToChat(input.attachmentId, chatId, actor)
        .catch(() => undefined);
    }

    return { ...reply, chatId };
  }

  private async think(
    input: AiIntakeRequest,
    actor: AuthenticatedUser,
  ): Promise<AiIntakeReply> {
    const model = await this.model();
    const { dataAccess, instructions, model: modelId } = await this.storedKey();
    const plans = await this.plans();
    const context = await this.context(plans);
    // After the cache breakpoint, deliberately: a new correction landing must
    // not throw away a 6,000-token prefix that has not changed.
    const corrections = await this.recentCorrections(actor);

    const lookupTools =
      dataAccess === "full" ? this.tools.definitionsFor(actor) : [];

    /**
     * A file the person attached is theirs and they chose to send it, so
     * reading it does not wait on the data-access setting — that setting is
     * about the company's books, which this is not. It still has to belong to
     * them: fetching it fails otherwise, and the tool says so.
     */
    const attachment = input.attachmentId
      ? await this.attachments.dto(input.attachmentId, actor).catch(() => null)
      : null;

    /**
     * The recent part of the conversation, oldest dropped rather than refused.
     *
     * The schema allows two hundred; this keeps the last sixty in the request
     * itself. A long conversation stays useful without growing the bill every
     * turn, and — the point — it never stops working. It has to start on a
     * `user` message: the API rejects a history that opens on `assistant`,
     * which is exactly what a naive slice produces half the time.
     */
    const recent = input.messages.slice(-60);
    while (recent.length && recent[0].role !== "user") recent.shift();

    const tools: ModelTool[] = [
      ...lookupTools,
      ...(attachment ? attachmentToolsFor(attachment) : []),
      {
        name: "answer",
        description:
          "Give the final answer: a draft to save, a question to ask, or a reply to what was asked.",
        input_schema: REPLY_SCHEMA,
      },
    ];

    // The same turn for either model; how it is put to each is the adapter's
    // business — see model-turn.ts.
    const conversation = model.converse({
      stablePrompt: this.stablePrompt(context, dataAccess, instructions),
      turnPrompt: this.turnPrompt(
        actor,
        corrections,
        input.target,
        this.carried(input.target, input.draft, plans),
        attachment
          ? {
              described: this.attachments.describe(attachment),
              kind: attachment.kind,
            }
          : null,
      ),
      messages: recent.length ? recent : input.messages.slice(-1),
      tools,
      maxTokens: MAX_ANSWER_TOKENS,
    });

    // What the person typed last: a part of the map may claim a draft by it.
    const said =
      [...input.messages].reverse().find((m) => m.role === "user")?.content ??
      "";
    // A draft was on the table when this was asked.
    const draftOpen = Boolean(
      input.target || Object.keys(input.draft ?? {}).length,
    );
    const asked = {
      role: actor.role,
      said,
      draftOpen,
      lastAnswer:
        [...input.messages].reverse().find((m) => m.role === "assistant")
          ?.content ?? null,
    };
    /** Whether an answer has been sent back once already, as filed wrongly. */
    let sentBack = false;

    for (let round = 0; round <= MAX_LOOKUPS; round++) {
      // On the last round it must stop looking and answer.
      const calls = await conversation.ask(
        round === MAX_LOOKUPS ? "answer" : undefined,
      );
      const answer = calls.find((c) => c.name === "answer");

      if (answer) {
        const reply = this.normalise(answer.input);
        const refusal = await this.refusal(reply, asked);

        /*
         * A draft filed in the wrong part of the app goes back to the model
         * once, with the reason, so it can draft the right kind of record in
         * this same turn. A second wrong answer is not argued with: `settle`
         * drops the draft and tells the person where the thing belongs.
         */
        if (refusal && !sentBack && round < MAX_LOOKUPS) {
          sentBack = true;
          this.log.warn(
            `A ${reply.target ?? reply.batch?.target ?? "draft"} was sent back: it belongs to ${refusal.part.key}.`,
          );
          conversation.tell(
            calls.map((call) => ({
              call,
              text:
                call === answer
                  ? refusal.tell
                  : "Not run: you had already answered.",
              ok: false,
            })),
          );
          continue;
        }

        const settled = await this.settle(reply, {
          accountNames: context.accounts.map((account) => account.name),
          draftOpen,
          plans,
          refusal,
          said,
        });
        // Which model answered goes on the conversation with the answer, so
        // a mistake marked on it later says whose it was (A2b). A plan for
        // Import cannot be made of a Doc's paragraphs: it would put a button
        // on the card that stages rows of text as money.
        return {
          ...settled,
          ...(attachment?.kind === "text" ? { importPlan: null } : {}),
          model: modelId,
        };
      }

      if (!calls.length) {
        throw new ServiceUnavailableException(
          "The assistant did not answer in the expected shape. Try the ordinary form.",
        );
      }

      const results: ModelCallResult[] = [];
      for (const call of calls) {
        // The two lists are dispatched separately on purpose — see
        // AI_ATTACHMENT_TOOLS. One reads the books under this person's
        // permissions; the other reads a file under their ownership.
        const result =
          AI_ATTACHMENT_TOOL_NAMES.includes(call.name) && input.attachmentId
            ? await this.attachments.runTool(
                call.name,
                call.input,
                input.attachmentId,
                actor,
              )
            : await this.tools.run(call.name, call.input, actor);
        results.push({ call, text: result.text, ok: result.ok });
      }
      conversation.tell(results);
    }

    throw new ServiceUnavailableException(
      "The assistant could not settle on an answer. Try the ordinary form.",
    );
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Reads a PDF statement into rows, using the key and model from Settings.
   *
   * Public because the upload endpoint needs it and this class owns the key.
   * It reads a file somebody handed over and writes nothing, so it is not
   * gated on what the person may see in the books — the same footing as the
   * two attachment tools.
   */
  async readPdf(
    buffer: Buffer,
  ): Promise<{ headers: string[]; rows: RawRow[] }> {
    return readPdfStatement(await this.model(), buffer);
  }

  /**
   * Built per call rather than cached: the key can change from Settings at any
   * moment, and a cached client would go on using the old one until a restart.
   *
   * Through Google Cloud when Settings says so (#131): the same requests, sent
   * to Vertex AI with the Connections service account. There the model
   * decides who is asked — Claude, or Gemini (2 Oct 2026), each through its
   * own adapter and with nothing else different.
   */
  private async model(): Promise<TurnModel> {
    const { key, provider, google, region, model } = await this.storedKey();

    if (provider === "vertex") {
      if (!google) {
        throw new ServiceUnavailableException(
          "The assistant is set to reach Claude through Google Cloud, and no Google Cloud key has been added. A Super Admin can add one under Settings → Connections, or use the ordinary form.",
        );
      }
      return isGeminiModel(model)
        ? geminiModel(geminiClient(google, region, GEMINI_TURN), model)
        : claudeModel(vertexClient(google, region), model);
    }

    if (!key) {
      throw new ServiceUnavailableException(
        "The assistant is not switched on. A Super Admin can add an API key under Settings, or use the ordinary form.",
      );
    }
    return claudeModel(new Anthropic({ apiKey: key }), model);
  }

  /**
   * The real names in this company's data.
   *
   * Without it the model invents plausible categories, and every draft then
   * fails validation for a reason the person cannot see. With it, it can only
   * choose something that exists.
   */
  private async context(plans: PlanRow[]) {
    const [categoryRows, accountRows] = await Promise.all([
      // Not a deleted one: it stays `is_active`, and the ledger refuses it.
      this.db.client
        .select({
          id: categories.id,
          name: categories.name,
          kind: categories.kind,
          parentId: categories.parentId,
        })
        .from(categories)
        .where(and(eq(categories.isActive, true), isNull(categories.deletedAt)))
        .limit(200),

      this.db.client
        .select({
          name: accounts.name,
          type: accounts.type,
          currency: accounts.currency,
        })
        .from(accounts)
        .where(and(eq(accounts.isActive, true), isNull(accounts.deletedAt)))
        .limit(50),
    ]);
    const planNames = planLabels(plans);

    // Two sub-categories may share a name under different headings; those
    // are listed as "Heading › Name", which `named()` reads back.
    const headings = new Map(
      categoryRows
        .filter((c) => c.parentId === null)
        .map((c) => [c.id, c.name]),
    );
    const leaves = categoryRows
      .filter((c) => c.parentId !== null)
      .map((c) => ({
        ...c,
        parentName: headings.get(c.parentId ?? "") ?? null,
      }));
    const labels = categoryLabels(leaves);

    return {
      // Only leaf categories — a payment filed against a heading rather than a
      // sub-category is the thing the two-level tree exists to prevent.
      /**
       * The name on its own, then what it is for — not "Electricity (out)".
       *
       * That form was read as the name itself. The model copied it whole,
       * `resolve()` looked for a category literally called "Electricity (out)"
       * and found none, and a conversation that had reached a complete draft
       * could not be saved at all. The separator makes the boundary obvious:
       * everything before the dash is the name to send back.
       */
      categories: leaves.map(
        (c) =>
          `${labels.get(c.id) ?? c.name}  —  ${c.kind === "in" ? "money in" : c.kind === "out" ? "money out" : "either"}`,
      ),
      /**
       * Each account with what kind it is, after the same dash the
       * categories use — so "cash theke" finds the cash account, and a
       * dollar account is known for one before a transfer is drafted on it.
       */
      accounts: accountRows.map((a) => ({
        name: a.name,
        line: `${a.name}  —  ${a.type.replace(/_/g, " ")}${a.currency === "USD" ? ", dollar account" : ""}`,
      })),
      /**
       * The plans under AI tools and subscriptions, one a line, after the
       * same dash: the name to send back, then whether it is running and how
       * often it renews. This list used to be the `vendors` table — a
       * register no screen shows any more — which is how the model came to
       * think a tool was a vendor.
       */
      plans: plans.map(
        (plan) =>
          `${planNames.get(plan.id) ?? plan.toolName}  —  ${plan.planName}, ${plan.status}, ${BILLING_CYCLE_LABELS[plan.billingCycle as BillingCycle]?.toLowerCase() ?? plan.billingCycle}`,
      ),
    };
  }

  /**
   * Every plan on file, with what a renewal's draft is filled from: its
   * price, its rate and the account it is paid from.
   *
   * Read once a turn. A new plan is held against these, a renewal names one
   * of them, and a plain payment that names one is pointed out.
   */
  private async plans(): Promise<PlanRow[]> {
    const rows = await this.db.client
      .select({
        id: subscriptions.id,
        toolName: subscriptions.toolName,
        planName: subscriptions.planName,
        status: subscriptions.status,
        billingCycle: subscriptions.billingCycle,
        costUsd: subscriptions.costUsd,
        chargeUsd: subscriptions.chargeUsd,
        usdRate: subscriptions.usdRate,
        accountId: subscriptions.accountId,
        accountName: accounts.name,
        accountCurrency: accounts.currency,
        boughtFor: subscriptions.boughtFor,
        startDate: subscriptions.startDate,
      })
      .from(subscriptions)
      .leftJoin(accounts, eq(subscriptions.accountId, accounts.id))
      .where(isNull(subscriptions.deletedAt))
      .orderBy(
        asc(subscriptions.toolName),
        asc(subscriptions.planName),
        asc(subscriptions.startDate),
      )
      .limit(300);

    // Two rows of one tool and one plan are told apart by who each was
    // bought for, or failing that by the day it started.
    return rows.map(({ boughtFor, startDate, ...plan }) => ({
      ...plan,
      hint: boughtFor?.trim() || `since ${startDate}`,
    }));
  }

  /**
   * Why this answer's draft is not offered — the person's role cannot save
   * it, or it belongs to another part of the app — or null. See routing.ts.
   */
  private async refusal(
    reply: AiIntakeReply,
    asked: Omit<RouteContext, "categories">,
  ): Promise<Refusal | null> {
    // Each category name is looked up once, however many rows carry it.
    const looked = new Map<string, RouteContext["categories"]>();
    const contextFor = async (draft: Record<string, unknown>) => {
      const name =
        typeof draft.categoryName === "string"
          ? bareName(draft.categoryName)
          : undefined;
      if (!name) return { ...asked, categories: [] };
      if (!looked.has(name)) {
        looked.set(name, await this.categoriesCalled(name));
      }
      return { ...asked, categories: looked.get(name) ?? [] };
    };

    if (reply.batch) {
      const target = reply.batch.target;
      // A plan, or its renewal, is never a row of a table.
      const oneAtATime = tableRefusalOf(target);
      if (oneAtATime) return oneAtATime;

      // The rest are held to the same as a single draft, row by row.
      for (const row of reply.batch.rows) {
        const refused = refusalOf(
          { area: reply.area, target, draft: row },
          target === "transaction_out"
            ? await contextFor(row)
            : { ...asked, categories: [] },
        );
        if (refused) return refused;
      }
      return null;
    }

    /*
     * A file about to be staged for Import becomes plain entries, row by
     * row. The category the whole file is to be filed under is held to the
     * map like a single payment's: a file of subscriptions staged as plain
     * payments is the owner's complaint, two hundred times over.
     */
    if (reply.importPlan) {
      const draft = {
        categoryName: reply.importPlan.categoryName ?? undefined,
      };
      const claimed = claimOn(
        "transaction_out",
        draft,
        await contextFor(draft),
      );
      return claimed?.part.claims
        ? { ...claimed, say: claimed.part.claims.sayOfAFile }
        : null;
    }

    return refusalOf(
      reply,
      reply.target === "transaction_out"
        ? await contextFor(reply.draft)
        : { ...asked, categories: [] },
    );
  }

  /**
   * The money-out categories a name could mean, each with the heading above
   * it — found the way a draft's own category is (`named`): the one spelled
   * exactly so, or else every one that contains it. A part of the map that
   * claims a category has to see what the name will resolve to, not only
   * what is spelled like it.
   */
  private async categoriesCalled(name: string) {
    const { heading, leaf } = underHeading(name);
    const parent = alias(categories, "parent");
    const rows = await this.db.client
      .select({ name: categories.name, heading: parent.name })
      .from(categories)
      .leftJoin(parent, eq(parent.id, categories.parentId))
      .where(
        and(
          eq(categories.isActive, true),
          isNull(categories.deletedAt),
          inArray(categories.kind, ["out", "both"]),
          ilike(categories.name, `%${leaf}%`),
        ),
      )
      .limit(50);

    const same = (a: string | null, b: string) =>
      (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();
    const exact = rows.filter((row) => same(row.name, leaf));
    return (exact.length ? exact : rows).filter(
      (row) => !heading || same(row.heading, heading),
    );
  }

  /**
   * The draft so far, as the model is shown it — less what the app itself
   * put there.
   *
   * A renewal's dollars and its account are filled in from the plan when
   * nobody stated them (draft-check.ts). Shown back to the model as
   * "already understood", they would outlive the plan they came from: "na,
   * ChatGPT er" after a draft for Claude would keep Claude's price and
   * Claude's card on a renewal of ChatGPT. So what equals the plan's own is
   * taken off here, and the check fills it in again from whichever plan the
   * answer names. A figure the person gave that happens to equal the plan's
   * comes back the same.
   */
  private carried(
    target: AiTarget | undefined,
    draft: Record<string, unknown> | undefined,
    plans: PlanRow[],
  ): Record<string, unknown> | undefined {
    if (target !== "subscription_payment" || !draft) return draft;
    const named =
      typeof draft.subscriptionName === "string"
        ? plansNamed(plans, draft.subscriptionName)
        : [];
    if (named.length !== 1) return draft;

    const plan = named[0];
    const rest = { ...draft };
    if (Number(rest.usdAmount) === Number(payableUsd(plan))) {
      delete rest.usdAmount;
    }
    if (
      typeof rest.accountName === "string" &&
      plan.accountName &&
      rest.accountName.trim().toLowerCase() ===
        plan.accountName.trim().toLowerCase()
    ) {
      delete rest.accountName;
    }
    return rest;
  }

  /**
   * The renewal this plan already has in the month of a date, in words — or
   * null. A plan renews once a month, and the endpoint refuses a second; a
   * draft that would be refused is not offered as ready.
   */
  private async alreadyRenewed(
    planId: string,
    txnDate: string,
  ): Promise<string | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) return null;
    const renewal = await renewalInMonth(this.db.client, planId, txnDate);
    return renewal
      ? `This plan was already renewed that month: ${renewal.refNo}, on ${renewal.txnDate}. A plan renews once a month. If this charge was for changing plan, that is an Upgrade, on the plan's row. Otherwise, what date was this one charged?`
      : null;
  }

  /**
   * The half of the prompt that is the same on every turn — and therefore the
   * half worth paying for once.
   *
   * It is much the larger half: the field reference for all five targets, the
   * rules, the category list, the accounts. Roughly nine tenths of what is
   * sent, re-sent and re-charged in full on every message of every
   * conversation, byte for byte identical each time.
   *
   * Splitting it out is not tidying. Caching is a *prefix* match, so one
   * changing byte early spoils everything after it — and the four things that
   * do change each turn (today's date, who is asking, what is being recorded,
   * the draft so far) were scattered through the middle of it. The draft in
   * particular changes on literally every turn, and sat above the field
   * reference. So there was nothing stable to cache, however the request was
   * marked up.
   *
   * Everything that varies now lives in `turnPrompt`, after the breakpoint.
   * The order changed; not one word of what it is told did.
   */
  private stablePrompt(
    context: {
      categories: string[];
      accounts: Array<{ name: string; line: string }>;
      plans: string[];
    },
    dataAccess: AiDataAccess,
    /** The owner's own rules. They change rarely, so they sit in this half. */
    instructions: string,
  ): string {
    return `You work inside ShareViral Finance Management, a Bangladesh company's internal books. You do two things: draft what somebody describes, for them to save, and answer questions about what is already recorded. You save nothing yourself.

YOU DRAFT. A PERSON SAVES.
Nothing you produce is in the books until somebody presses Save on the draft
card. So never say, in any language, that something is recorded, saved,
transferred, added, entered or done — no "recorded", no "record korechi", no
"save hoye geche", no "done". It is not true, and they will believe it.
When a draft is complete, say nothing about it. The app checks it against what
the form accepts and writes the line under the draft itself.

HOW TO WRITE
Answer in one or two sentences. No greeting, no "I'd be happy to", no summary of
what you are about to do, no offer of further help. The person is at work and
wants the answer.
State a figure and where it came from. If you do not know, say what is missing
in one line.
Never invent a number, a date or a name. An amount nobody gave you is the single
most damaging thing you can produce here.

HOW THEY WRITE, AND HOW YOU ANSWER
Most people here write Bangla in Latin letters with English mixed in:
"ms/exprovia theke 1 lakh taka transfer koro". Answer the way they wrote —
Bangla in Latin letters to that, Bangla script to Bangla script, English to
English. Plain and short, the way a colleague at the next desk would say it:
not formal Bangla, and not a form.

THE MAP OF THIS APP
Every part of the app, written beside the code it describes: what it is for,
what is kept there, its screens, and what you may do there. One ledger runs
under all of it: every movement of money is IN or OUT of an account, with a
date, an amount and a category, and most money screens are views of that one
list. But not everything is a plain entry in it. Several parts keep records
of their own, and a record filed as a plain payment instead of in its own
part shows on All transactions and nowhere on the page it belongs to. That
is the mistake the owner will not have.

${renderAppMap()}
${
  instructions.trim()
    ? `
THE OWNER'S INSTRUCTIONS
The company's owner wrote these, in their own words, for you. Follow them.
They say where things belong and how this company files them, and they add
to THE MAP above: where one of them and the map disagree about where a
record belongs, the instruction is the newer word and it wins.
They cannot give anybody a permission, a look-up or a kind of record the app
itself does not give them. If one seems to, the app's refusal stands, and
you say so.
<<<
${instructions.trim()}
>>>
`
    : ""
}
WHAT THIS APP CANNOT DO
Know these as well as you know what it can do. Saying "yes" to something the
app does not have does not fail politely — the person acts on it, and finds out
at the point where it costs them work.
- The import screen takes TRANSACTIONS ONLY. A file of people, of vendors, of
  anything that is not money moving in or out of an account cannot go through
  it. For those, read the file and propose the records yourself in 'batch' —
  see MANY RECORDS AT ONCE below.
- You cannot press anything. You have no button, no screen and no save. Never
  tell somebody to press a control unless it is one of these two, which are
  the only ones that exist: **Save** on the draft card you produced, and **Send
  to Import** on the file card. If what they want needs a control that is not
  one of those, the honest answer is that it is not there.
- You cannot edit or delete anything that is already recorded, and you cannot
  void a transaction. Those are done on the screens.
- You cannot see or record what anybody is paid now. There is no tool for it
  at any setting.
- You cannot open a link. A Google Sheet, Doc or Drive file pasted into the
  chat is read by the app before you see the message, and arrives below as
  FILE ATTACHED or DOCUMENT ATTACHED. If a message holds a link and nothing
  below says it was read, it was not: say so, and ask them to attach the file.
  Never say what a link might hold.
- You have no memory between conversations beyond what somebody corrected on a
  draft or marked wrong, and the owner's instructions above. A person who
  thinks an answer of yours was wrong can say so with "This was wrong" under
  it; the owner sees those, and can make one a rule.

WHEN YOU ARE NOT SURE, ASK — that is not a failure, it is the job
This app is somebody's books. A wrong answer given confidently costs more than
a question. If a file does not obviously match one of the records below, if a
column could be two things, if a name might be a person already on the team —
say what you see, say what you are unsure of, and ask. Do not guess a route
through the app and describe it as though you had checked.

FIRST, WHERE IT BELONGS
Before you draft anything, decide which part of THE MAP the request belongs
to, and give that part's key in 'area'. Then:
- If the part says you can draft there, draft that kind of record and no
  other.
- If it says you cannot, do not draft. Say what its last line says, in the
  person's own register, with 'area' set and 'target' left out. The app puts
  the way to that screen beside your answer.
- Never file something as a plain payment (transaction_out) because you have
  no better place for it. Having nowhere to put a thing is an answer: say so,
  and name the screen.
The app checks this after you answer. A draft filed in the wrong part is
refused and sent back to you.

The ones that are easy to get wrong:
- Money paid to or received from somebody outside -> transaction_out /
  transaction_in                                           [transactions]
- Money moved between two of OUR OWN accounts  -> transfer    [transfers]
- Anything called a subscription — software, an AI tool, hosting or a server,
  a domain — bought, paid or renewed                      [subscriptions]
    not on file yet                            -> subscription
    listed under PLANS ON FILE below           -> subscription_payment
    cannot tell which                          -> ask: a new plan, or the
                                                  renewal of the one on file?
- A supplier's tax details (e-TIN, BIN, PSR)   -> vendor        [vendors]
  Never a tool or a subscription.
- Somebody who works here                      -> team_member      [team]
- Tax deposited to the treasury, with challan  -> tds_deposit       [tds]
- Salary, a bonus, anybody's pay               -> nothing        [payroll]
A transfer is when BOTH ends are accounts listed under OUR ACCOUNTS below:
"EXPROVIA theke Standard Chartered e 1 lakh". Nothing was spent and nobody was
paid, so it has no category and no counterparty, and it is never
transaction_out. Give fromAccountName and toAccountName, and do not ask what it
was for. If only one end is one of our accounts, it is not a transfer: it is
money going out or coming in.
Salary is never recorded as a transaction: it comes from a payroll run. If
somebody describes paying salaries, say so and point them at Payroll.
Tax withheld belongs only on money going OUT. If a client deducted tax when
paying us, that is an advance-tax credit and belongs under Income tax, not on
the receipt.

A NEW PLAN, AND A RENEWAL
Both are records of AI tools and subscriptions, and both show on that page.
- subscription: a plan that is not on file yet. toolName is the tool
  ("Claude"), planName the plan of it that was bought ("Max"). Plans are
  priced in dollars: costUsd is the price, and if they gave only taka, ask
  what it costs in dollars. Saving the plan records its first payment too,
  out of accountName, on startDate — so never draft a payment for it as well.
- subscription_payment: this cycle's payment for a plan listed under PLANS ON
  FILE. Give subscriptionName exactly as listed, and the date the card was
  charged. Leave usdAmount and accountName out unless they said them: the app
  puts the plan's own price and card on the card for them to check. The rate
  is asked every time; it is not the same from one renewal to the next.
- If the tool they name is under PLANS ON FILE, "kinlam", "bill dilam" and
  "renew korlam" all most likely mean this month's payment for it. Ask which
  it is rather than adding a second plan.
- An upgrade, a pause, a cancellation, or who is on a plan: you cannot draft
  these. Say they are done from the plan's row.

The currency is BDT unless the person says otherwise.

${
  dataAccess === "full"
    ? `LOOKING THINGS UP
You have read-only tools. Use them freely and use them first. Checking costs a
second; being wrong about somebody's books costs a great deal more.

Look before you answer, and look before you draft:
- Is this person already on the team? Has this bill already been entered? Is
  this the account they meant? Check rather than assume.
- Working from a file, check what is already recorded before proposing to add
  it. Somebody handing over a spreadsheet usually does not know what is in
  there twice.
- If you find something that does not add up, say so. That is worth more than
  the answer they asked for.

Every tool runs as this person: if one refuses, say plainly that their role
cannot see that, and do not try another route to the same answer.
When you have the answer, call \`answer\` with it in the summary field, target
null and missingFields empty.`
    : `You have no way to look anything up. If asked about existing records, say
in one line that lookups are switched off in Settings, and answer nothing else.`
}

Bangla numerals and words for amounts are common: "pnach hajar" and "৫০০০" both mean 5000; "lakh" is 100,000; "crore" is 10,000,000.

WHAT YOU CAN RECORD
${AI_TARGETS.map((t) => `- ${t}: ${AI_TARGET_LABELS[t]}`).join("\n")}

EVERY FIELD, AND NOTHING ELSE

This list is generated from the same schemas the API validates with, so it is
exactly what will be accepted. Two rules follow from that, and both matter:

  * Put a key in 'draft' ONLY if it appears below for this target. A field that
    is not here is rejected outright when the entry is saved — there is no
    'currencyCode', no 'vendorName', no 'paidTo'. If you have information with
    nowhere to go, put it in 'description' or 'notes'.
  * Ask for every REQUIRED field before you finish. List the ones you still
    need in 'missingFields'.

${allFieldReferences()}

FIELDS THAT COME IN PAIRS
The list above shows each field on its own, so it cannot show these. Each one
below is refused at save time even though both fields read as optional.
${pairedFields()}

MANY RECORDS AT ONCE
When somebody has a file — or a message — holding several records of the SAME
kind, put them all in 'batch' rather than drafting one and asking about the
next. Seventeen people is one answer, not seventeen conversations.

  * Every row goes in the same shape 'draft' would take for that target, under
    the same rules: nothing invented, no field that is not on the list.
  * Read the whole file before proposing. Use read_attachment to see the rows
    rather than working from the summary alone.
  * Look first. Check whether these are already recorded — a file somebody
    hands over has often been handed over once before. Say what you found.
  * Settle the ambiguities BEFORE you propose, in one message, not one question
    at a time: which column is the joining date, whether a blank means unknown
    or nil, what to do with the two rows whose email is malformed. A batch is
    reviewed as a table, and a wrong assumption repeated seventeen times is
    much harder to spot than a wrong single draft.
  * A row you cannot complete is still worth proposing with what you have —
    say which rows are short of what, and let them fix it in the table.
  * Transactions are the exception: for a file of money moving, use importPlan,
    because the import screen checks each row against the ledger for
    duplicates and can be undone as a batch afterwards.

NEVER INVENT A VALUE
If you do not know something, leave the key OUT of 'draft' entirely and name it
in 'missingFields'. Do not guess, do not pick the likeliest account, and never
write a placeholder like "<UNKNOWN>" or "N/A" — a guessed account name resolves
to a real account and files the money in the wrong place, which reads as
perfectly normal afterwards. A key you have omitted is a question you will ask;
a key you have guessed is an error nobody will catch.

Never list a field in 'missingFields' and also give it a value. If it has a
value it is not missing.

EVERY VALUE IS A STRING
Amounts, dates and rates go in as text — "10000.00", not 10000. A bare number
is rejected when the entry is saved.

MONEY IS ALWAYS TAKA
'amount' is the taka that moved, always — never a foreign figure. If somebody
says "10000 dollar ashche", the amount is NOT 10000: that is dollars, and
booking it as taka understates the entry more than a hundredfold. Ask what
landed in taka, put the dollars in 'originalAmount' with 'originalCurrency'
"USD", and ask for the rate the bank gave — it goes in 'fxRate' and the entry
is refused without it.
A transfer is the same: 'amount' is the taka. Only when one of the two accounts
is marked "dollar account" do the dollars that moved go beside it, in
'usdAmount' — ask for them, never work them out.
A plan and its renewal are the two places a figure is dollars by its nature:
costUsd, and a renewal's usdAmount. Their names say so. Never put taka in
either, and never turn one currency into the other yourself.

DATES
"aaj" is today, "kal" is yesterday for a past payment. Never guess a date
nobody implied — ask.

A FEW THINGS THE SCHEMA CANNOT SAY
  * Tax withheld applies only to money going out, never to money coming in.
  * Never ask who was paid as a separate field. The company keeps no supplier
    list and the form does not collect one — who it went to belongs in the
    description, in their own words.
  * Do not ask about pay on a team member. A joining salary is on the record
    but HR types it on the form themselves, and what anybody is paid now lives
    somewhere you cannot reach. If somebody offers a figure, say it belongs on
    the team form and leave it out of the draft.

THE CATEGORIES THAT EXIST
Send back ONLY the name — the part before the dash. "Electricity", never
"Electricity  —  money out". Where two share a name they are written with
their heading, "Office › Rent": send that back whole. Use a "money out" or
"either" one for money going out and a "money in" or "either" one for money
coming in. If none fits, leave categoryName out and ask which it should be: a
payment cannot be saved without one.
${context.categories.join("\n") || "(none set up yet)"}

OUR ACCOUNTS
The company's own accounts. As with a category, send back ONLY the name — the
part before the dash. "M/S. EXPROVIA", never "M/S. EXPROVIA  —  bank".
${context.accounts.map((account) => account.line).join("\n") || "(none)"}

PLANS ON FILE
The plans under AI tools and subscriptions. As with a category, send back
ONLY the name — the part before the dash — as subscriptionName on a renewal.
Never use one to fill in a field on a plain payment.
${context.plans.join("\n") || "(none yet)"}

HOW TO ASK
Say in a few words what you understood, then ask for ONE missing thing, in a
short sentence: "EXPROVIA theke 5,000 taka, internet bill — kon category te
jabe?" Do not list everything you still need; it reads like a form and they
will stop.
If what they said could be more than one account, category or person, do not
pick one. Name the ones it could be, exactly as the books have them, and ask
which.
Never invent a value to fill a gap. An amount you were not told is the single
most damaging thing you can produce here — leave it missing and ask.
usdRate is one of these, and it is the easiest to get wrong: you know roughly
what a dollar is worth and that is exactly why you must not write it. It is
REQUIRED wherever the field list above says so — which is every entry that
moves money, a payment, a receipt or a transfer, whatever currency the account
is in: the company's rule is that each entry states the day's rate. Ask for it
like any other missing field, last, and say in a few words that every entry
carries one. Never ask for it where the list does not have it.
When nothing required is missing, set missingFields to [] and leave
nextQuestion and summary out.`;
  }

  /**
   * The handful of things that are different this turn.
   *
   * Sent after the cached block, so changing any of it costs only itself.
   */
  private turnPrompt(
    actor: AuthenticatedUser,
    corrections: string,
    target?: AiTarget,
    draft?: Record<string, unknown>,
    attachment?: { described: string; kind: "table" | "text" } | null,
  ): string {
    // A draft this person could not save is not theirs to be offered.
    const barred = AI_TARGETS.filter(
      (kind) =>
        !AI_TARGET_PERMISSION[kind].every((permission) =>
          hasPermission(actor.role, permission),
        ),
    );

    return `Today in Dhaka is ${todayInDhaka()}. The person asking is signed in as ${actor.fullName} (${actor.role}).
${barred.length ? `Their role cannot save: ${barred.join(", ")}. Do not draft those for them. Say in one line that their role cannot record it.\n` : ""}
${corrections}

${
  attachment?.kind === "text"
    ? `${attachment.described}

WORKING FROM A DOCUMENT
Answer from the text above, and read_attachment for the rest of it. A
document cannot go to Import, so never send an importPlan for it. If they
want records made from it, draft them as usual: one record, or several of the
same kind at once (MANY RECORDS AT ONCE). Every figure exactly as the document
writes it; whatever it does not say, ask.
`
    : attachment
      ? `${attachment.described}

WORKING FROM A FILE
Answer from the summary and the two file tools. The totals were computed from
the file in code — quote them, never re-add them, and never estimate a figure
you could group_attachment for.
If they want the rows entered in the books, do NOT draft them one at a time.
Drafting a hundred entries through this conversation would put a hundred
figures past review. Build an importPlan instead:

  1. You need to know which account the whole file belongs to. If they have not
     said, ask — that is the one thing you must never assume, exactly as with a
     single entry.
  2. Work out columnMap from the headings: which of the file's columns is the
     date, the description, the amount. A file with separate credit and debit
     columns maps them to amountIn and amountOut; a single signed column is
     amount. If there is one amount column and nothing anywhere says which way
     the money went, ask, and put the answer in assumeDirection.
  3. If the file carries no category of its own, ask what these should be filed
     as and put it in categoryName. If it has a category column, map it and
     leave categoryName out.
  4. Look at how the dates are actually written in the rows before choosing
     dateFormat. 05/08/2026 in a Bangladeshi export is 5 August — dmy.
  5. Ask for the USD rate the file should be read at and put it in usdRate.
     Every entry in this app states one, so a batch cannot be staged without
     it, and it is not something to work out or carry over from anywhere —
     the answer has to come from them.

Send the plan only when there is nothing left to ask — a plan in the same turn
as a question puts a button beside it that stages a batch you already know is
incomplete. Ask first, plan on the turn after they answer.

Send it with a one-line note saying what is about to be staged. They
press the button; you never stage anything yourself. They then see every row
with what it would become, the duplicates flagged, and can undo the whole batch
afterwards.
One row, or a handful they read out to you, is different — draft that as usual.
`
      : ""
}
${target ? `They are recording: ${target}. Stay on it unless they clearly change subject.` : "Work out which one they mean. If it is genuinely ambiguous, set clarification and ask."}

${draft && Object.keys(draft).length ? `Already understood:\n${JSON.stringify(draft, null, 2)}\nKeep these unless they correct one.` : ""}`;
  }

  /** Trust nothing from the model: shape it, or drop it. */
  private normalise(raw: Record<string, unknown>): AiIntakeReply {
    const target =
      typeof raw.target === "string" &&
      (AI_TARGETS as readonly string[]).includes(raw.target)
        ? (raw.target as AiTarget)
        : null;

    const missingFields = Array.isArray(raw.missingFields)
      ? raw.missingFields.filter((f): f is string => typeof f === "string")
      : [];

    /**
     * The draft, with everything the model did not actually know taken out.
     *
     * The prompt tells it to omit what it does not know and never to write a
     * placeholder. It mostly obeys and sometimes does not — it has produced
     * `"<UNKNOWN>"` as an account name, and listed a field in `missingFields`
     * while also giving it a value. Neither is harmless: `resolve()` turns an
     * account *name* into an id, so a plausible guess files real money in the
     * wrong account and reads as normal ever afterwards.
     *
     * So the rule is enforced here rather than requested. A model that ignores
     * the instruction now produces an empty field and a question, which is the
     * behaviour the instruction was asking for.
     */
    const rawDraft =
      raw.draft && typeof raw.draft === "object" && !Array.isArray(raw.draft)
        ? (raw.draft as Record<string, unknown>)
        : {};

    const stillMissing = new Set(missingFields);
    const draft: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(rawDraft)) {
      // It cannot be both answered and outstanding. The question wins: a value
      // it is unsure enough to also list as missing is a value it invented.
      if (stillMissing.has(key)) continue;
      if (isPlaceholder(value)) continue;
      draft[key] = value;
    }

    return {
      // Only a part the map has; anything else is read as not said.
      area: partOf(typeof raw.area === "string" ? raw.area : null)?.key ?? null,
      target,
      draft,
      missingFields,
      nextQuestion:
        typeof raw.nextQuestion === "string" && raw.nextQuestion.trim()
          ? raw.nextQuestion.trim()
          : null,
      summary:
        typeof raw.summary === "string" && raw.summary.trim()
          ? raw.summary.trim()
          : null,
      clarification:
        typeof raw.clarification === "string" && raw.clarification.trim()
          ? raw.clarification.trim()
          : null,
      importPlan: importPlanOf(raw.importPlan),
      batch: this.batchOf(raw.batch),
    };
  }

  /**
   * The answer, held to what the code can check (2 Oct 2026).
   *
   * `normalise` shapes what the model sent; this decides what it amounts to.
   * Three things were the model's word and are now the code's, whichever
   * model answers:
   *
   * - **Whether a draft is complete.** It is put through the schema its Save
   *   will use, with its names looked up in the books — draft-check.ts. What
   *   that refuses becomes `missingFields` and a question, so the card cannot
   *   offer Save on a form the endpoint would turn away.
   * - **Which account a name means.** One that matches several is asked
   *   about, with the real ones listed, rather than quietly taken as the
   *   first.
   * - **The line under a ready draft.** `AI_DRAFT_READY_LINE`, always. The
   *   model's own sentence is shown only as a question or as an answer, and
   *   never when it says something has been recorded.
   *
   * And a fourth, the same day: **which part of the app it belongs to.** A
   * draft the map gives to another part, or one this person's role could not
   * save, is dropped here, and the person is told where the thing is kept —
   * routing.ts. This is what stands between "buy an AI subscription" and a
   * plain payment the subscriptions page never shows.
   */
  private async settle(
    answered: AiIntakeReply,
    books: {
      accountNames: string[];
      /** Whether the conversation had a draft on the table when asked. */
      draftOpen: boolean;
      plans: PlanRow[];
      /** Why the draft cannot be offered, when the model was already told. */
      refusal: Refusal | null;
      /** What the person typed last. */
      said: string;
    },
  ): Promise<AiIntakeReply> {
    const { accountNames, draftOpen, plans, refusal } = books;

    if (refusal) {
      this.log.warn(
        `A ${answered.target ?? answered.batch?.target ?? "draft"} was dropped: it belongs to ${refusal.part.key}.`,
      );
      const asks = refusal.say.trim().endsWith("?");
      return {
        ...answered,
        area: refusal.part.key,
        screen: screenOf(refusal.part),
        target: null,
        draft: {},
        missingFields: [],
        batch: null,
        importPlan: null,
        nextQuestion: asks ? refusal.say : null,
        clarification: null,
        summary: asks ? null : refusal.say,
      };
    }

    // The part it belongs to, and — with nothing to save — the way to the
    // screen where the person does it themselves.
    const area = areaOf(answered);
    const reply: AiIntakeReply = {
      ...answered,
      area,
      screen:
        answered.target || answered.batch || answered.importPlan
          ? null
          : screenOf(partOf(area)),
    };

    const said = reply.nextQuestion ?? reply.clarification ?? reply.summary;
    const instead = (
      summary: string,
      from: AiIntakeReply = reply,
    ): AiIntakeReply => {
      // Not the sentence itself: it may quote a figure from the books.
      this.log.warn(
        "The model said something had been recorded; its sentence was replaced.",
      );
      return { ...from, nextQuestion: null, clarification: null, summary };
    };

    /*
     * A table of rows and a file's plan are cards of their own, saved or
     * staged by a button. Their sentence and their one-line note are held to
     * the first person only: "3 of these are already recorded, so I left them
     * out" is what the model is asked to say beside them.
     */
    if (reply.batch || reply.importPlan) {
      const honest = (note: string | null) =>
        note && claimsItIsDone(note, false) ? null : note;
      const carded: AiIntakeReply = {
        ...reply,
        batch: reply.batch
          ? { ...reply.batch, note: honest(reply.batch.note) }
          : reply.batch,
        importPlan: reply.importPlan
          ? { ...reply.importPlan, note: honest(reply.importPlan.note) }
          : reply.importPlan,
      };
      return said && claimsItIsDone(said, false)
        ? instead(reply.batch ? BATCH_LINE : PLAN_LINE, carded)
        : carded;
    }

    // With a draft on the table, "it has been recorded" is as untrue as "I
    // recorded it" — and dropping the target is how a model says it is done.
    if (!reply.target) {
      return said && claimsItIsDone(said, draftOpen)
        ? instead(NOTHING_RECORDED_LINE)
        : reply;
    }

    const target = reply.target;
    // A category goes one way, and the ledger refuses the other.
    const way =
      target === "transaction_in"
        ? "in"
        : target === "transaction_out"
          ? "out"
          : undefined;
    const tidy = tidyDraft(reply.draft);
    const matches: NameMatches = {};
    for (const { field, said: name } of namesIn(target, tidy)) {
      matches[field.name] = await this.named(field, name, way, plans);
    }
    const checked = checkDraft(target, tidy, matches, accountNames, plans);

    /*
     * A plan renews once a month, and its endpoint refuses a second renewal.
     * Asked here, of the same rule, so the card does not offer a Save that
     * can only answer with that refusal. It is put first: there is no point
     * asking this renewal's rate when it is the date that is wrong.
     */
    const renewing =
      target === "subscription_payment" &&
      matches.subscriptionName?.length === 1
        ? matches.subscriptionName[0]
        : null;
    const charged = checked.draft.txnDate;
    if (
      renewing &&
      typeof charged === "string" &&
      !checked.problems.some((problem) => problem.field === "txnDate")
    ) {
      const already = await this.alreadyRenewed(renewing.id, charged);
      if (already) {
        delete checked.draft.txnDate;
        checked.problems.unshift({ field: "txnDate", question: already });
      }
    }

    /*
     * What the books hold that the person should hear with this draft: a
     * plan of this name already on file, or — on a plain payment — a plan
     * whose tool the payment names. Said, never enforced, and said once: on
     * the turn the draft first appears, and again when it is ready to save.
     */
    const named =
      target === "transaction_out"
        ? planNamedIn(plans, [
            books.said,
            checked.draft.description,
            checked.draft.notes,
          ])
        : null;
    const notes = [
      ...checked.notes,
      ...(named
        ? [
            `${named} is on file under AI tools and subscriptions. If this is its payment, say so and I will draft the renewal instead of a plain payment.`,
          ]
        : []),
    ];

    // What the model itself still wants answered — less anything this record
    // has no field for, which no answer could ever settle.
    const asked = reply.missingFields
      .map(nameOf)
      .filter((field) => knowsField(target, field))
      .filter((field) => !(field in checked.draft));
    const missingFields = [
      ...new Set([...checked.problems.map((p) => p.field), ...asked]),
    ];

    if (!missingFields.length) {
      return {
        ...reply,
        draft: checked.draft,
        missingFields,
        nextQuestion: null,
        clarification: null,
        summary: [...notes, AI_DRAFT_READY_LINE].join(" "),
      };
    }

    // Its own question, in the person's own register, when it has one. The
    // code's otherwise: about the first thing the schema refused.
    const own = reply.nextQuestion ?? reply.clarification;
    const coded =
      checked.problems[0]?.question ?? askFor(missingFields[0], target);
    // With no question of its own, what it did say may be the answer to
    // something asked along the way. It is kept, ahead of the question —
    // unless it says the thing is done.
    const aside =
      !own && reply.summary && !claimsItIsDone(reply.summary, true)
        ? `${reply.summary} `
        : "";
    const heard = !draftOpen && notes.length ? `${notes.join(" ")} ` : "";
    return {
      ...reply,
      draft: checked.draft,
      missingFields,
      nextQuestion: `${heard}${
        own && !claimsItIsDone(own, true) ? own : `${aside}${coded}`
      }`,
      clarification: null,
      summary: null,
    };
  }

  /**
   * The proposed rows, put through the same sieve a single draft goes through.
   *
   * Not a formality. A batch is the one place where one careless value becomes
   * seventeen: a placeholder in a column the model was unsure about is a
   * plausible wrong value on every row, and nobody reads the seventeenth as
   * carefully as the first. So each row loses its placeholders exactly as a
   * draft does, and a row left with nothing is dropped rather than shown as an
   * empty line somebody has to notice.
   */
  private batchOf(value: unknown): AiBatch | null {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;

    const raw = value as { target?: unknown; rows?: unknown; note?: unknown };
    if (
      typeof raw.target !== "string" ||
      !(AI_TARGETS as readonly string[]).includes(raw.target)
    ) {
      return null;
    }
    if (!Array.isArray(raw.rows)) return null;

    const rows: Array<Record<string, unknown>> = [];
    for (const entry of raw.rows.slice(0, AI_BATCH_MAX_ROWS)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

      const row: Record<string, unknown> = {};
      for (const [key, cell] of Object.entries(
        entry as Record<string, unknown>,
      )) {
        if (isPlaceholder(cell)) continue;
        row[key] = cell;
      }
      if (Object.keys(row).length) rows.push(row);
    }

    if (!rows.length) return null;

    return {
      target: raw.target as AiTarget,
      rows,
      note:
        typeof raw.note === "string" && raw.note.trim()
          ? raw.note.trim()
          : null,
    };
  }

  /**
   * Records what somebody changed on a draft before saving it.
   *
   * Called after the save, never before, and its failure is swallowed by the
   * caller: a lesson not learnt is a shame, a save undone because the lesson
   * could not be filed would be indefensible.
   *
   * The two halves come from different places on purpose. The confirmed values
   * are passed in, because they are what the person actually pressed the
   * button on. What the assistant had drafted is read from the conversation
   * here rather than accepted from the browser — otherwise "what the model got
   * wrong" would be whatever the caller said it was.
   */
  async learn(
    chatId: string,
    target: AiTarget,
    confirmed: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<{ recorded: number }> {
    const chat = await this.chats.get(chatId, actor);

    const drafted =
      chat.reply && typeof chat.reply === "object"
        ? ((chat.reply as { draft?: Record<string, unknown> }).draft ?? {})
        : {};

    const changes = diffDraft(drafted, confirmed);
    if (!changes.length) return { recorded: 0 };

    // What they typed, not what the assistant said back — the lesson is the
    // mapping from their words to the right value.
    const said = [...chat.messages]
      .reverse()
      .find((m) => m.role === "user")?.content;
    if (!said) return { recorded: 0 };

    await this.db.client.insert(aiCorrections).values(
      changes.map((change) => ({
        kind: "field" as const,
        target,
        // Where the draft was, and whose it was: read from the conversation,
        // like the draft itself (A2b).
        area: partOf(chat.reply?.area)?.key ?? null,
        said: maskDigits(said).slice(0, 400),
        field: change.field,
        // A description is free text and can carry a figure; a category or
        // an account name is a name, and masking it would lose the lesson.
        drafted:
          change.field === "description" && change.drafted
            ? maskDigits(change.drafted)
            : change.drafted,
        corrected:
          change.field === "description" && change.corrected
            ? maskDigits(change.corrected)
            : change.corrected,
        model: chat.reply?.model?.slice(0, 64) ?? null,
        userId: actor.id,
      })),
    );

    return { recorded: changes.length };
  }

  /**
   * The recent lessons this person is allowed to be shown: drafts somebody
   * fixed before Save, and answers somebody marked wrong (A2b).
   *
   * Gated by the permission for the record type, because this is the one place
   * where what one person did is put in front of another. An answer that
   * drafted nothing is gated on its part of the map instead, as the part's
   * own screen is; one that can be placed in neither is shown to nobody's
   * model and stays on the owner's list. Deduplicated on the lesson itself:
   * somebody filing the same correction every month should not crowd out
   * the other nine. One the owner made a rule is left out: its rule is
   * already in the prompt, in the owner's words.
   */
  private async recentCorrections(actor: AuthenticatedUser): Promise<string> {
    const allowed = (AI_TARGETS as readonly AiTarget[]).filter((target) =>
      hasPermission(actor.role, CORRECTION_PERMISSION[target]),
    );

    /**
     * This runs on every single turn, and what it fetches is a nicety.
     *
     * `ai_corrections` is newer than the deployments that may be running, and
     * a table that is not there yet must not be the reason the assistant stops
     * answering. Without this the first turn after a deploy — on any database
     * where the table has not been created — is a 500 on a feature nobody was
     * using yet, and the whole assistant reads as broken.
     *
     * Anything else that goes wrong here deserves the same treatment for the
     * same reason: no past example is worth a failed conversation.
     */
    const rows = await this.db.client
      .select({
        kind: aiCorrections.kind,
        target: aiCorrections.target,
        area: aiCorrections.area,
        said: aiCorrections.said,
        field: aiCorrections.field,
        drafted: aiCorrections.drafted,
        corrected: aiCorrections.corrected,
      })
      .from(aiCorrections)
      .where(
        and(
          isNull(aiCorrections.ruledAt),
          or(
            // A field changed before Save, on a kind of record they may read.
            allowed.length
              ? and(
                  eq(aiCorrections.kind, "field"),
                  inArray(aiCorrections.target, allowed),
                )
              : undefined,
            // An answer marked wrong: gated row by row below.
            eq(aiCorrections.kind, "reply"),
          ),
        ),
      )
      .orderBy(desc(aiCorrections.createdAt))
      .limit(120)
      .catch((error: unknown) => {
        this.log.warn(
          `Past corrections could not be read, carrying on without them: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as Array<{
          kind: "field" | "reply";
          target: string | null;
          area: string | null;
          said: string;
          field: string | null;
          drafted: string | null;
          corrected: string | null;
        }>;
      });

    const seen = new Set<string>();
    const fields = rows.flatMap((row) => {
      // Every field row names its field; this is for the type.
      if (row.kind !== "field" || !row.field) return [];
      const key = `${row.field}|${row.drafted ?? ""}|${row.corrected ?? ""}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...row, field: row.field }];
    });

    const replies = rows.filter((row) => {
      if (row.kind !== "reply" || !this.mayBeShown(actor, row)) return false;
      const key = `reply|${row.said}|${row.corrected ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return [
      renderCorrections(fields.slice(0, 12)),
      renderReplyMistakes(replies.slice(0, 8)),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Whether a mistake may go into this person's prompt: the permission for
   * the kind of record it drafted, or, where it drafted nothing, the one its
   * part of the map asks for. Placed in neither: nobody's.
   */
  private mayBeShown(
    actor: AuthenticatedUser,
    row: { target: string | null; area: string | null },
  ): boolean {
    if (row.target) {
      return (
        (AI_TARGETS as readonly string[]).includes(row.target) &&
        hasPermission(actor.role, CORRECTION_PERMISSION[row.target as AiTarget])
      );
    }
    const part = partOf(row.area);
    if (!part) return false;
    return !part.permission || hasPermission(actor.role, part.permission);
  }

  /* --- it gets better with use (A2b) ------------------------------------ */

  /**
   * "This was wrong", said of the answer this conversation ended on.
   *
   * Only the reason comes from the browser. What was asked and what was
   * answered are read from the conversation here, as `learn` reads the
   * draft, so a mistake on file is what was really said. Digits are masked
   * in all three: the row is read into other people's prompts, and this
   * table keeps no money.
   */
  async feedback(
    input: AiFeedbackInput,
    actor: AuthenticatedUser,
  ): Promise<{ recorded: true }> {
    const chat = await this.chats.get(input.chatId, actor);
    const reply = chat.reply;
    const said = [...chat.messages]
      .reverse()
      .find((m) => m.role === "user")?.content;

    if (!reply || !said) {
      throw new BadRequestException(
        "There is no answer in this conversation to mark yet.",
      );
    }

    await this.db.client.insert(aiCorrections).values({
      kind: "reply",
      target: reply.target ?? reply.batch?.target ?? null,
      area: partOf(reply.area)?.key ?? null,
      said: maskDigits(said).slice(0, 400),
      drafted: maskDigits(describeReply(reply)).slice(0, 600),
      corrected: maskDigits(input.reason).slice(0, 500),
      model: reply.model?.slice(0, 64) ?? null,
      userId: actor.id,
    });

    return { recorded: true };
  }

  /**
   * The owner's list of mistakes, newest first: both kinds, the rules among
   * them marked, each with the line "Make this a rule" would offer.
   */
  async mistakes(): Promise<AiMistake[]> {
    const rows = await this.db.client
      .select({
        id: aiCorrections.id,
        kind: aiCorrections.kind,
        target: aiCorrections.target,
        area: aiCorrections.area,
        said: aiCorrections.said,
        field: aiCorrections.field,
        drafted: aiCorrections.drafted,
        corrected: aiCorrections.corrected,
        model: aiCorrections.model,
        ruledAt: aiCorrections.ruledAt,
        by: users.fullName,
        at: aiCorrections.createdAt,
      })
      .from(aiCorrections)
      .leftJoin(users, eq(aiCorrections.userId, users.id))
      .orderBy(desc(aiCorrections.createdAt))
      .limit(100);

    return rows.map((row) => {
      const target = (AI_TARGETS as readonly string[]).includes(
        row.target ?? "",
      )
        ? (row.target as AiTarget)
        : null;
      // A row from before A2b names no part; its kind of record says where.
      const part =
        partOf(row.area) ??
        (target ? (partsDrafting(target)[0] ?? null) : null);
      return {
        id: row.id,
        kind: row.kind,
        target,
        area: part?.key ?? null,
        areaName: part?.name ?? null,
        said: row.said,
        field: row.field,
        drafted: row.drafted,
        corrected: row.corrected,
        model: row.model,
        ruledAt: row.ruledAt ? row.ruledAt.toISOString() : null,
        by: row.by,
        at: row.at.toISOString(),
        rule: proposedRule(row),
      };
    });
  }

  /**
   * "Make this a rule": one line added to the owner's instructions, and the
   * mistake marked as ruled, in one transaction with its audit row.
   *
   * Audited as a change to the instructions, before and after, like
   * `setInstructions` — the instructions are what the Assistant reads, and
   * the log should show every way they changed. A line already there is
   * not added twice.
   */
  async makeRule(
    id: string,
    input: MakeAiRuleInput,
    actor: AuthenticatedUser,
  ): Promise<AiInstructions> {
    const [mistake] = await this.db.client
      .select({ id: aiCorrections.id, ruledAt: aiCorrections.ruledAt })
      .from(aiCorrections)
      .where(eq(aiCorrections.id, id))
      .limit(1);
    if (!mistake) throw new NotFoundException("That mistake is not on file.");
    if (mistake.ruledAt) {
      throw new BadRequestException("That one is already one of your rules.");
    }

    const current = (await this.instructions()).instructions.trim();
    const lines = current ? current.split("\n").map((line) => line.trim()) : [];
    const next = lines.includes(input.rule)
      ? current
      : [current, input.rule].filter(Boolean).join("\n");

    if (next.length > AI_INSTRUCTIONS_MAX) {
      throw new BadRequestException(
        `The instructions would be ${next.length.toLocaleString("en-US")} characters, over the ${AI_INSTRUCTIONS_MAX.toLocaleString("en-US")} they may hold. Shorten or remove a rule under Settings, Assistant first.`,
      );
    }

    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Made a mistake of the Assistant one of its instructions",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ instructions: appSettings.aiInstructions })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const now = new Date();
        await tx
          .update(appSettings)
          .set({
            aiInstructions: next,
            aiInstructionsSetAt: now,
            aiInstructionsSetBy: actor.id,
            updatedAt: now,
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
        await tx
          .update(aiCorrections)
          .set({ ruledAt: now })
          .where(eq(aiCorrections.id, id));
      },
    });

    return this.instructions();
  }

  /**
   * Takes a mistake off the list, and out of every prompt from the next
   * message. For a lesson that was itself wrong: somebody marked a right
   * answer wrong, or changed a field by mistake. A rule made from it stays
   * in the instructions, where the owner removes it.
   */
  async forgetMistake(id: string): Promise<void> {
    await this.audit.mutate({
      action: "delete",
      entityTable: "ai_corrections",
      entityId: id,
      summary: "Took a mistake off the Assistant's list",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({
            kind: aiCorrections.kind,
            target: aiCorrections.target,
            area: aiCorrections.area,
            said: aiCorrections.said,
            field: aiCorrections.field,
            drafted: aiCorrections.drafted,
            corrected: aiCorrections.corrected,
          })
          .from(aiCorrections)
          .where(eq(aiCorrections.id, id))
          .limit(1);
        if (!row) throw new NotFoundException("That mistake is not on file.");
        return row;
      },
      run: async (tx) => {
        await tx.delete(aiCorrections).where(eq(aiCorrections.id, id));
      },
    });
  }

  /**
   * The map the Assistant is given, for "What the Assistant knows". The
   * same entries the prompt is written from, so what the page shows is what
   * the model reads.
   */
  knowledge(): AiKnowledge {
    const screens = APP_MAP.flatMap((part) => part.screens);
    return {
      parts: APP_MAP.map((part) => ({
        key: part.key,
        name: part.name,
        purpose: part.purpose,
        keeps: [...part.keeps],
        screens: part.screens.map((screen) => ({ ...screen })),
        drafts: part.assistant.drafts.map((target) => AI_TARGET_LABELS[target]),
        reads: [...part.assistant.reads],
        otherwise: part.assistant.otherwise,
        forms: part.forms.map((form) => {
          const on = screens.find((screen) => screen.href === form.on);
          return {
            name: form.name,
            on: on ? { name: on.name, href: on.href } : null,
            opens: form.opens,
            onSave: form.onSave,
            draft: form.draft ? AI_TARGET_LABELS[form.draft] : null,
            fields: fieldsOf(form),
          };
        }),
      })),
    };
  }

  /**
   * A plan for a whole file, turned into the mapping the import screen uses.
   *
   * Names become ids through the same `resolve` a single draft goes through,
   * so "Standard Chartered" has to be an account that exists — the assistant
   * cannot invent somewhere for a file of money to land any more than it can
   * for one payment.
   */
  async importMapping(plan: AiImportPlan): Promise<MappingInput> {
    const resolved = await this.resolve({
      accountName: plan.accountName,
      ...(plan.categoryName ? { categoryName: plan.categoryName } : {}),
    });

    const accountId = resolved.accountId;
    if (typeof accountId !== "string") {
      throw new BadRequestException(
        `There is no account called "${plan.accountName}".`,
      );
    }

    const fallbackCategoryId =
      typeof resolved.categoryId === "string" ? resolved.categoryId : undefined;

    /*
     * Refused rather than filled in. A rate the model chose would be a figure
     * nobody typed sitting on every row of the batch, which is the one thing
     * this app does not do with money.
     */
    if (!plan.usdRate || !(Number(plan.usdRate) > 0)) {
      throw new BadRequestException(
        "Ask what USD rate this file should be read at — every row it writes carries one.",
      );
    }

    return {
      columnMap: plan.columnMap as MappingInput["columnMap"],
      defaults: {
        accountId,
        usdRate: plan.usdRate,
        dateFormat: plan.dateFormat ?? "dmy",
        ...(fallbackCategoryId ? { fallbackCategoryId } : {}),
        ...(plan.assumeDirection
          ? { assumeDirection: plan.assumeDirection }
          : {}),
      },
    };
  }

  /**
   * Turns the names the model produced into the ids the endpoint needs.
   *
   * Kept here rather than asked of the model: a uuid it guessed would either
   * fail validation or, far worse, resolve to a real but unrelated record.
   */
  async resolve(draft: Record<string, unknown>) {
    const out: Record<string, unknown> = { ...draft };
    const found: Partial<Record<NameField["name"], string>> = {};

    for (const field of NAME_FIELDS) {
      const inIdKey = takeString(out, field.id);
      const name = bareName(takeString(out, field.name) ?? inIdKey);
      if (!name) continue;

      const matches = await this.named(field, name);
      if (matches.length === 1) {
        out[field.id] = matches[0].id;
        found[field.name] = matches[0].name;
        continue;
      }

      /*
       * Refused, both ways. An account nobody has was left unset, and the
       * save then failed on "expected string, received undefined". And a name
       * several accounts share was given to whichever the database returned
       * first — real money in an account nobody chose.
       */
      throw new BadRequestException(
        matches.length
          ? `"${name}" could be ${matches.map((m) => m.name).join(", ")}. Type the full name of the one you mean.`
          : `There is no ${field.kind} called "${name}". Type its name as the app has it.`,
      );
    }

    // A transfer is described by its two accounts when nothing else was said
    // — as the draft's check does, and for a row of a batch, which that
    // check never saw.
    const described =
      typeof out.description === "string" && out.description.trim();
    if (found.fromAccountName && found.toAccountName && !described) {
      out.description = `Transfer from ${found.fromAccountName} to ${found.toAccountName}`;
    }

    return out;
  }

  /**
   * What the books hold under a name: the one spelled exactly so, or else
   * every one that contains it.
   *
   * Every one, not the first. The caller decides what several means — a
   * question on a draft, a refusal on a save — and neither is "pick one".
   */
  private async named(
    field: NameField,
    name: string,
    /** For a category: the direction of the entry it is wanted for. */
    way?: "in" | "out",
    /** For a plan: the plans on file, when the caller has read them already. */
    plansRead?: PlanRow[],
  ): Promise<NameMatch[]> {
    if (field.kind === "plan") {
      const plans = plansRead ?? (await this.plans());
      const labels = planLabels(plans);
      return plansNamed(plans, name).map((plan) => ({
        id: plan.id,
        name: labels.get(plan.id) ?? plan.toolName,
        plan: {
          payableUsd: payableUsd(plan),
          usdRate: plan.usdRate,
          account:
            plan.accountId && plan.accountName
              ? {
                  id: plan.accountId,
                  name: plan.accountName,
                  currency: plan.accountCurrency,
                }
              : null,
        },
      }));
    }

    if (field.kind === "account") {
      const rows = await this.db.client
        .select({
          id: accounts.id,
          name: accounts.name,
          currency: accounts.currency,
        })
        .from(accounts)
        .where(
          and(isNull(accounts.deletedAt), ilike(accounts.name, `%${name}%`)),
        )
        .orderBy(accounts.name)
        .limit(12);
      const exact = rows.filter(
        (row) => row.name.trim().toLowerCase() === name.toLowerCase(),
      );
      return exact.length ? exact : rows;
    }

    /*
     * What the ledger itself will take, and nothing else: not a deleted
     * category (it stays `is_active`, and is refused as "No such category"),
     * and — when the direction is known — not one that goes the other way.
     * A draft that named either read as ready and could not be saved.
     */
    const parent = alias(categories, "parent");
    const rows = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        parentId: categories.parentId,
        parentName: parent.name,
      })
      .from(categories)
      .leftJoin(parent, eq(parent.id, categories.parentId))
      .where(
        and(
          eq(categories.isActive, true),
          isNull(categories.deletedAt),
          ilike(categories.name, `%${underHeading(name).leaf}%`),
          way ? inArray(categories.kind, [way, "both"]) : undefined,
        ),
      )
      .orderBy(categories.name)
      .limit(50);

    return categoryMatches(rows, name);
  }
}

/* -------------------------------------------------------------------------- */

function takeString(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) return null;
  // A uuid is already resolved; leave it alone.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return null;
  delete source[key];
  return value.trim();
}

const IMPORT_FIELDS = TRANSACTION_FIELDS;

/**
 * The plan, with anything the model made up dropped.
 *
 * `columnMap` is the part worth guarding: a heading that is not in the file is
 * harmless, but a *field* we do not have would be rejected deep inside the
 * import mapping with an error about a column nobody typed. Anything not in
 * IMPORT_FIELDS becomes "ignore this column", which is the safe reading.
 *
 * An account is deliberately NOT defaulted here. It is the one thing that says
 * where a whole file of money lands, and a plan without one is no plan.
 */
function importPlanOf(value: unknown): AiImportPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const accountName =
    typeof raw.accountName === "string" ? raw.accountName.trim() : "";
  if (!accountName || isPlaceholder(accountName)) return null;

  const columnMap: Record<string, string | null> = {};
  const rawMap =
    raw.columnMap && typeof raw.columnMap === "object"
      ? (raw.columnMap as Record<string, unknown>)
      : {};

  for (const [header, field] of Object.entries(rawMap)) {
    columnMap[header] =
      typeof field === "string" &&
      (IMPORT_FIELDS as readonly string[]).includes(field)
        ? field
        : null;
  }

  if (!Object.values(columnMap).some(Boolean)) return null;

  const categoryName =
    typeof raw.categoryName === "string" &&
    raw.categoryName.trim() &&
    !isPlaceholder(raw.categoryName)
      ? (bareName(raw.categoryName) ?? null)
      : null;

  /**
   * A plan with nowhere to file the rows is not a plan yet.
   *
   * Seen in a real conversation: asked where five statement rows belonged, it
   * answered the account, sensibly objected that "office expense" is not one
   * of the categories — and attached the plan to the same turn with no
   * category in it. Staging that put five rows on the import screen, every one
   * of them an error reading "No category, and no fallback chosen".
   *
   * The question it asked was the right question. Offering a button beside it
   * that stages a batch of nothing but errors is not. So a plan needs a
   * category the same way a draft needs an amount: either the file carries its
   * own column, or the person has named one.
   */
  const carriesCategory = Object.values(columnMap).includes("categoryName");
  if (!carriesCategory && !categoryName) return null;

  const oneOf = <T extends string>(v: unknown, allowed: readonly T[]) =>
    typeof v === "string" && (allowed as readonly string[]).includes(v)
      ? (v as T)
      : null;

  return {
    accountName,
    categoryName,
    columnMap,
    dateFormat: oneOf(raw.dateFormat, ["dmy", "mdy", "ymd", "auto"] as const),
    assumeDirection: oneOf(raw.assumeDirection, ["in", "out"] as const),
    usdRate: typeof raw.usdRate === "string" ? raw.usdRate.trim() : null,
    note:
      typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null,
  };
}

const REPLY_SCHEMA = {
  type: "object" as const,
  properties: {
    area: {
      type: "string",
      enum: [...APP_PART_KEYS],
      description:
        "Which part of THE MAP this belongs to — its key. Decide this first, and give it on every answer.",
    },
    target: {
      type: "string",
      enum: [...AI_TARGETS],
      description: "What kind of record this is. Omit if not yet clear.",
    },
    draft: {
      type: "object",
      additionalProperties: true,
      description:
        "Fields understood so far, in the shape the form expects. Never include a value you were not told.",
    },
    missingFields: {
      type: "array",
      items: { type: "string" },
      description: "Required fields still unanswered. Empty when complete.",
    },
    nextQuestion: {
      type: "string",
      description:
        "The single next question, after a few words of what you understood. Omit when nothing is missing.",
    },
    summary: {
      type: "string",
      description:
        "The answer to something they asked about the books. Leave it out when you are drafting: the app writes the line under a draft itself.",
    },
    clarification: {
      type: "string",
      description: "Ask this when you cannot tell what they are recording.",
    },
    batch: {
      type: "object",
      description:
        "Many records of the SAME kind, understood at once — a sheet of staff, a list of vendors. Use this instead of 'draft' when there is more than one. They are reviewed as a table and saved one at a time; you save nothing.",
      properties: {
        target: {
          type: "string",
          enum: [...AI_TARGETS],
          description: "What kind of record every row is. All rows are this.",
        },
        rows: {
          type: "array",
          description:
            "One object per record, each in exactly the shape 'draft' would take for this target. Same rules: no invented values, no field that is not in the list for this target.",
          items: { type: "object", additionalProperties: true },
        },
        note: {
          type: "string",
          description:
            "One line naming what these are, e.g. '17 staff from the sheet'.",
        },
      },
      required: ["target", "rows"],
    },
    importPlan: {
      type: "object",
      description:
        "Only for an attached file of many rows, once they have said which account it is. Staging it is a button they press, not something you do.",
      properties: {
        accountName: {
          type: "string",
          description: "The account every row belongs to, exactly as listed.",
        },
        categoryName: {
          type: "string",
          description:
            "Category for rows that do not carry their own. Omit if the file has a category column.",
        },
        columnMap: {
          type: "object",
          additionalProperties: { type: ["string", "null"] },
          description: `The file's heading → one of: ${IMPORT_FIELDS.join(", ")}. Leave a heading out to ignore that column.`,
        },
        dateFormat: {
          type: "string",
          enum: ["dmy", "mdy", "ymd", "auto"],
          description:
            "How this file writes dates. 05/08/2026 in a Bangladeshi export is 5 August — dmy.",
        },
        assumeDirection: {
          type: "string",
          enum: ["in", "out"],
          description:
            "Only when there is one amount column and nothing says which way the money went.",
        },
        usdRate: {
          type: "string",
          description:
            "Taka per US dollar, as they stated it. Every row the file writes carries it. Ask; never assume.",
        },
        note: {
          type: "string",
          description: "One line naming what is about to be staged.",
        },
      },
      required: ["accountName", "columnMap", "usdRate"],
    },
  },
  required: ["area", "draft", "missingFields"],
};

/**
 * A value that says "I do not know" while looking like an answer.
 *
 * Angle-bracket placeholders are what a model reaches for when a schema says a
 * field is required and it has nothing to put there. Blank strings are the
 * same thing, quieter.
 */
function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;

  const text = value.trim();
  if (!text) return true;
  if (text.startsWith("<") && text.endsWith(">")) return true;

  return ["unknown", "n/a", "na", "none", "null", "tbd", "-", "?"].includes(
    text.toLowerCase(),
  );
}
