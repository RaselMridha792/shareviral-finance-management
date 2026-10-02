import Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AI_BATCH_MAX_ROWS,
  AI_DRAFT_READY_LINE,
  AI_PROVIDER_LABELS,
  AI_TARGETS,
  AI_TARGET_LABELS,
  aiModelFrom,
  aiModelProviderProblem,
  hasPermission,
  isGeminiModel,
  todayInDhaka,
  type AiAvailability,
  type AiBatch,
  type AiIntakeReply,
  type AiImportPlan,
  type AiIntakeRequest,
  type AiDataAccess,
  type AiKeyResult,
  type AiMessage,
  type AiModel,
  type AiProvider,
  type AiTarget,
  type UpdateAiSettingsInput,
} from "@finance/shared";
import { and, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { AuditService } from "../../common/audit/audit.service";
import {
  AI_ATTACHMENT_TOOLS,
  AI_ATTACHMENT_TOOL_NAMES,
  AiAttachmentsService,
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
  tidyDraft,
  underHeading,
  type NameMatch,
  type NameMatches,
} from "./draft-check";
import {
  CORRECTION_PERMISSION,
  diffDraft,
  maskDigits,
  renderCorrections,
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
  users,
  vendors,
} from "../../db/schema";

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
    const { dataAccess } = await this.storedKey();
    const context = await this.context();
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
      ...(attachment ? AI_ATTACHMENT_TOOLS : []),
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
      stablePrompt: this.stablePrompt(context, dataAccess),
      turnPrompt: this.turnPrompt(
        actor,
        corrections,
        input.target,
        input.draft,
        attachment ? this.attachments.describe(attachment) : null,
      ),
      messages: recent.length ? recent : input.messages.slice(-1),
      tools,
      maxTokens: MAX_ANSWER_TOKENS,
    });

    for (let round = 0; round <= MAX_LOOKUPS; round++) {
      // On the last round it must stop looking and answer.
      const calls = await conversation.ask(
        round === MAX_LOOKUPS ? "answer" : undefined,
      );
      const answer = calls.find((c) => c.name === "answer");

      if (answer) {
        return this.settle(
          this.normalise(answer.input),
          context.accounts.map((account) => account.name),
          // A draft was on the table when this was asked.
          Boolean(input.target || Object.keys(input.draft ?? {}).length),
        );
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
  private async context() {
    const [categoryRows, accountRows, vendorRows] = await Promise.all([
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

      this.db.client
        .select({ name: vendors.name })
        .from(vendors)
        .where(and(eq(vendors.isActive, true), isNull(vendors.deletedAt)))
        .limit(200),
    ]);

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
      vendors: vendorRows.map((v) => v.name),
    };
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
      vendors: string[];
    },
    dataAccess: AiDataAccess,
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

WHAT THIS APP HOLDS
- One ledger: every movement of money is IN or OUT of an account, with a date,
  an amount and a category. Expenses, the transaction list
  and the bank register are three views of that one list.
- Accounts: bank, cash and mobile wallet, each with an opening balance.
- Categories: two levels. A payment is filed against a sub-category, never a
  heading.
- Vendors: whoever is paid, with e-TIN, BIN and PSR status.
- Team: employees and contractors. The salary agreed at hire is on the person;
  what they are paid now is in a separate table you have no tool for and must
  never report. Do not collect either.
- Payroll: one run a month. Generate the sheet, type each person's tax,
  finalise (nothing moves), then mark paid (the net leaves the bank; the tax
  stays until a challan is deposited). Contractors are never on the sheet.
- Withholding tax: what was deducted from salaries and vendor bills, against
  what was deposited by challan. Quarterly returns, due 25 Oct/Jan/Apr/Jul.
- Company income tax: four advance instalments plus the annual return.
- Reports: a period, month-by-month bank statistics, and funding from the CEO
  in USD.

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
- You have no memory between conversations beyond what somebody corrected on a
  draft.

WHEN YOU ARE NOT SURE, ASK — that is not a failure, it is the job
This app is somebody's books. A wrong answer given confidently costs more than
a question. If a file does not obviously match one of the records below, if a
column could be two things, if a name might be a person already on the team —
say what you see, say what you are unsure of, and ask. Do not guess a route
through the app and describe it as though you had checked.

WHERE A NEW RECORD BELONGS — decide this yourself, do not ask
- Money paid to or received from somebody else -> transaction_out / transaction_in
- Money moved between two of OUR OWN accounts  -> transfer
- A tool or subscription the company pays for  -> vendor
- Somebody who works here                      -> team_member
- Tax deposited to the treasury, with challan  -> tds_deposit
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

TOOLS AND SUBSCRIPTIONS ON FILE: ${context.vendors.join(", ") || "(none)"}
These are for recognising what somebody is talking about — never to fill in a
field on a transaction. A payment records who it went to in its description.

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
    attachment?: string | null,
  ): string {
    return `Today in Dhaka is ${todayInDhaka()}. The person asking is signed in as ${actor.fullName} (${actor.role}).

${corrections}

${
  attachment
    ? `${attachment}

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
   */
  private async settle(
    reply: AiIntakeReply,
    accountNames: string[],
    /** Whether the conversation had a draft on the table when asked. */
    draftOpen: boolean,
  ): Promise<AiIntakeReply> {
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
      matches[field.name] = await this.named(field, name, way);
    }
    const checked = checkDraft(target, tidy, matches, accountNames);

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
        summary: AI_DRAFT_READY_LINE,
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
    return {
      ...reply,
      draft: checked.draft,
      missingFields,
      nextQuestion:
        own && !claimsItIsDone(own, true) ? own : `${aside}${coded}`,
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
        target,
        said: maskDigits(said).slice(0, 400),
        field: change.field,
        drafted: change.drafted,
        corrected: change.corrected,
        userId: actor.id,
      })),
    );

    return { recorded: changes.length };
  }

  /**
   * The recent lessons this person is allowed to be shown.
   *
   * Gated by the permission for the record type, because this is the one place
   * where what one person did is put in front of another. Deduplicated on the
   * lesson itself: somebody filing the same correction every month should not
   * crowd out the other nine.
   */
  private async recentCorrections(actor: AuthenticatedUser): Promise<string> {
    const allowed = (AI_TARGETS as readonly AiTarget[]).filter((target) =>
      hasPermission(actor.role, CORRECTION_PERMISSION[target]),
    );
    if (!allowed.length) return "";

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
        said: aiCorrections.said,
        field: aiCorrections.field,
        drafted: aiCorrections.drafted,
        corrected: aiCorrections.corrected,
      })
      .from(aiCorrections)
      .where(inArray(aiCorrections.target, allowed))
      .orderBy(desc(aiCorrections.createdAt))
      .limit(60)
      .catch((error: unknown) => {
        this.log.warn(
          `Past corrections could not be read, carrying on without them: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as Array<{
          said: string;
          field: string;
          drafted: string | null;
          corrected: string | null;
        }>;
      });

    const seen = new Set<string>();
    const distinct = rows.filter((row) => {
      const key = `${row.field}|${row.drafted ?? ""}|${row.corrected ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return renderCorrections(distinct.slice(0, 12));
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
  ): Promise<NameMatch[]> {
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
  required: ["draft", "missingFields"],
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
