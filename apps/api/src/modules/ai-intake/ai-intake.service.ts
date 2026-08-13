import Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AI_MODELS,
  AI_TARGETS,
  AI_TARGET_LABELS,
  todayInDhaka,
  type AiAvailability,
  type AiIntakeReply,
  type AiIntakeRequest,
  type AiDataAccess,
  type AiKeyResult,
  type AiMessage,
  type AiModel,
  type AiTarget,
  type UpdateAiSettingsInput,
} from "@finance/shared";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import {
  AI_ATTACHMENT_TOOLS,
  AI_ATTACHMENT_TOOL_NAMES,
  AiAttachmentsService,
} from "./ai-attachments.service";
import { AiChatsService } from "./ai-chats.service";
import { AiToolsService } from "./ai-tools";
import { hint, open, seal } from "../../common/crypto/secret-box";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  accounts,
  appSettings,
  categories,
  users,
  vendors,
} from "../../db/schema";

/** Used to check a key before the settings row is known to be readable. */
const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * How many times the model may look something up before it has to answer.
 *
 * Four is enough for "what did we pay Grameenphone this year, and is the tax on
 * it deposited" — two lookups and a comparison. It is also low enough that a
 * confused loop costs pennies and ends.
 */
const MAX_LOOKUPS = 4;

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
  }> {
    const [row] = await this.db.client
      .select({
        sealed: appSettings.anthropicApiKey,
        setAt: appSettings.anthropicKeySetAt,
        setBy: users.fullName,
        model: appSettings.aiModel,
        dataAccess: appSettings.aiDataAccess,
      })
      .from(appSettings)
      .leftJoin(users, eq(appSettings.anthropicKeySetBy, users.id))
      .where(eq(appSettings.id, 1))
      .limit(1);

    const model = (AI_MODELS as readonly string[]).includes(row?.model ?? "")
      ? (row.model as AiModel)
      : DEFAULT_MODEL;
    const dataAccess = (row?.dataAccess ?? "names_only") as AiDataAccess;

    const fromSettings = open(row?.sealed);
    if (fromSettings) {
      return {
        key: fromSettings,
        fromEnvironment: false,
        setAt: row?.setAt ?? null,
        setBy: row?.setBy ?? null,
        model,
        dataAccess,
      };
    }

    return {
      key: process.env.ANTHROPIC_API_KEY ?? null,
      fromEnvironment: Boolean(process.env.ANTHROPIC_API_KEY),
      setAt: null,
      setBy: null,
      model,
      dataAccess,
    };
  }

  /** Model and data access. The key is not touched here. */
  async updateSettings(input: UpdateAiSettingsInput, actor: AuthenticatedUser) {
    await this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary:
        "Changed the assistant's " +
        [
          input.model ? "model to " + input.model : null,
          input.dataAccess ? "data access to " + input.dataAccess : null,
        ]
          .filter(Boolean)
          .join(" and "),
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({
            model: appSettings.aiModel,
            dataAccess: appSettings.aiDataAccess,
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

    if (!stored.key) {
      return {
        configured: false,
        reason:
          "No API key has been set, so the assistant cannot run. A Super Admin can add one under Settings. Everything the assistant would do can be done on the ordinary forms.",
        keyHint: null,
        setAt: null,
        setBy: null,
        fromEnvironment: false,
        model: stored.model,
        dataAccess: "off",
      };
    }

    return {
      configured: true,
      reason: null,
      keyHint: hint(stored.key),
      setAt: stored.setAt ? stored.setAt.toISOString() : null,
      setBy: stored.setBy,
      fromEnvironment: stored.fromEnvironment,
      model: stored.model,
      dataAccess: stored.dataAccess,
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
    const reply = await this.think(input, actor);

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
    const client = await this.anthropic();
    const { model, dataAccess } = await this.storedKey();
    const context = await this.context();

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

    const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const tools: Anthropic.Tool[] = [
      ...lookupTools,
      ...(attachment ? AI_ATTACHMENT_TOOLS : []),
      {
        name: "answer",
        description:
          "Give the final answer: a draft to save, a question to ask, or a reply to what was asked.",
        input_schema: REPLY_SCHEMA,
      },
    ];

    for (let round = 0; round <= MAX_LOOKUPS; round++) {
      const response = await client.messages.create({
        model,
        max_tokens: 1500,
        system: this.systemPrompt(
          context,
          dataAccess,
          actor,
          input.target,
          input.draft,
          attachment ? this.attachments.describe(attachment) : null,
        ),
        messages,
        tools,
        // On the last round it must stop looking and answer.
        tool_choice:
          round === MAX_LOOKUPS
            ? { type: "tool", name: "answer" }
            : { type: "any" },
      });

      const calls = response.content.filter((c) => c.type === "tool_use");
      const answer = calls.find((c) => c.name === "answer");

      if (answer) {
        return this.normalise(answer.input as Record<string, unknown>);
      }

      if (!calls.length) {
        throw new ServiceUnavailableException(
          "The assistant did not answer in the expected shape. Try the ordinary form.",
        );
      }

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        const args = (call.input ?? {}) as Record<string, unknown>;

        // The two lists are dispatched separately on purpose — see
        // AI_ATTACHMENT_TOOLS. One reads the books under this person's
        // permissions; the other reads a file under their ownership.
        const result =
          AI_ATTACHMENT_TOOL_NAMES.includes(call.name) && input.attachmentId
            ? await this.attachments.runTool(
                call.name,
                args,
                input.attachmentId,
                actor,
              )
            : await this.tools.run(call.name, args, actor);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: result.text,
          is_error: !result.ok,
        });
      }
      messages.push({ role: "user", content: results });
    }

    throw new ServiceUnavailableException(
      "The assistant could not settle on an answer. Try the ordinary form.",
    );
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Built per call rather than cached: the key can change from Settings at any
   * moment, and a cached client would go on using the old one until a restart.
   */
  private async anthropic(): Promise<Anthropic> {
    const { key } = await this.storedKey();
    if (!key) {
      throw new ServiceUnavailableException(
        "The assistant is not switched on. A Super Admin can add an API key under Settings, or use the ordinary form.",
      );
    }
    return new Anthropic({ apiKey: key });
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
      this.db.client
        .select({
          name: categories.name,
          kind: categories.kind,
          parentId: categories.parentId,
        })
        .from(categories)
        .where(eq(categories.isActive, true))
        .limit(200),

      this.db.client
        .select({ name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.isActive, true), isNull(accounts.deletedAt)))
        .limit(50),

      this.db.client
        .select({ name: vendors.name })
        .from(vendors)
        .where(and(eq(vendors.isActive, true), isNull(vendors.deletedAt)))
        .limit(200),
    ]);

    return {
      // Only leaf categories — a payment filed against a heading rather than a
      // sub-category is the thing the two-level tree exists to prevent.
      categories: categoryRows
        .filter((c) => c.parentId !== null)
        .map((c) => `${c.name} (${c.kind})`),
      accounts: accountRows.map((a) => a.name),
      vendors: vendorRows.map((v) => v.name),
    };
  }

  private systemPrompt(
    context: { categories: string[]; accounts: string[]; vendors: string[] },
    dataAccess: AiDataAccess,
    actor: AuthenticatedUser,
    target?: AiTarget,
    draft?: Record<string, unknown>,
    attachment?: string | null,
  ): string {
    return `You work inside ShareViral Finance Management, a Bangladesh company's internal books. You do two things: record what somebody describes, and answer questions about what is already recorded. You save nothing yourself.

HOW TO WRITE
Answer in one or two sentences. No greeting, no "I'd be happy to", no summary of
what you are about to do, no offer of further help. The person is at work and
wants the answer.
State a figure and where it came from. If you do not know, say what is missing
in one line.
Never invent a number, a date or a name. An amount nobody gave you is the single
most damaging thing you can produce here.

WHAT THIS APP HOLDS
- One ledger: every movement of money is IN or OUT of an account, with a date,
  an amount, a category, and usually a vendor. Expenses, the transaction list
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

WHERE A NEW RECORD BELONGS — decide this yourself, do not ask
- Money paid or received, of any kind         -> transaction_out / transaction_in
- Somebody the company pays                   -> vendor
- Somebody who works here                     -> team_member
- Tax deposited to the treasury, with challan -> tds_deposit
Salary is never recorded as a transaction: it comes from a payroll run. If
somebody describes paying salaries, say so and point them at Payroll.
Tax withheld belongs only on money going OUT. If a client deducted tax when
paying us, that is an advance-tax credit and belongs under Income tax, not on
the receipt.

Today in Dhaka is ${todayInDhaka()}. The currency is BDT unless the person says otherwise. The person asking is signed in as ${actor.fullName} (${actor.role}).

${
  dataAccess === "full"
    ? `LOOKING THINGS UP
You have read-only tools. Use them whenever a question is about what is already
recorded rather than about something new — do not guess or say you cannot see
the data. Every tool runs as this person: if one refuses, say plainly that their
role cannot see that, and do not try another route to the same answer.
When you have the answer, call \`answer\` with it in the summary field, target
null and missingFields empty.`
    : `You have no way to look anything up. If asked about existing records, say
in one line that lookups are switched off in Settings, and answer nothing else.`
}

${
  attachment
    ? `${attachment}

WORKING FROM A FILE
Answer from the summary and the two file tools. The totals were computed from
the file in code — quote them, never re-add them, and never estimate a figure
you could group_attachment for.
If they want the rows entered in the books, do NOT draft them one at a time.
Say how many rows it is and what they look like, and tell them to press "Send
to Import" on the file, where they can map the columns, see every row before
it is written, and undo the whole batch afterwards. Drafting a hundred entries
through this conversation would put a hundred figures past review.
One row, or a handful they read out to you, is different — draft that as usual.
`
    : ""
}
They write in Bangla, in English, or in both in one sentence. Answer in whichever they used. Bangla numerals and words for amounts are common: "pnach hajar" and "৫০০০" both mean 5000; "lakh" is 100,000; "crore" is 10,000,000.

WHAT YOU CAN RECORD
${AI_TARGETS.map((t) => `- ${t}: ${AI_TARGET_LABELS[t]}`).join("\n")}

${target ? `They are recording: ${target}. Stay on it unless they clearly change subject.` : "Work out which one they mean. If it is genuinely ambiguous, set clarification and ask."}

${draft && Object.keys(draft).length ? `Already understood:\n${JSON.stringify(draft, null, 2)}\nKeep these unless they correct one.` : ""}

REQUIRED FIELDS

transaction_out / transaction_in
  txnDate       YYYY-MM-DD. "aaj" is today, "kal" is yesterday for a past
                payment. Never guess a date they have not implied.
  amount        digits only, two decimals, no separators: "8500.00"
  description   what it was for, in their words
  categoryId    the exact category NAME from the list below; the app resolves it
  accountName   which account it moved through, if they said

transaction_out may also have: billAmount, withheldTaxAmount
  (tax withheld only applies to money going out — never to money coming in)
  Never ask who was paid as a separate field. The company keeps no supplier
  list and the form no longer collects one — who it went to belongs in the
  description, in their own words.

vendor: name. May also have: type, etin, bin
team_member: fullName, employeeCode, joinedOn. Do not ask about pay. A joining
  salary is on the record but HR types it on the form themselves, and what
  anybody is paid now lives somewhere you cannot reach at all. If somebody
  offers a figure, say it belongs on the team form and leave it out of the
  draft.
tds_deposit: challanNumber, challanDate, depositDate, amount, periodYear,
  periodMonth

THE CATEGORIES THAT EXIST (use one of these names exactly, or leave it out)
${context.categories.join("\n") || "(none set up yet)"}

ACCOUNTS: ${context.accounts.join(", ") || "(none)"}
VENDORS ALREADY ON FILE: ${context.vendors.slice(0, 60).join(", ") || "(none)"}
A vendor not on that list is fine — it will be created.

HOW TO ASK
Ask for ONE missing field at a time, in a short sentence. Do not list
everything you still need; it reads like a form and they will stop.
Never invent a value to fill a gap. An amount you were not told is the single
most damaging thing you can produce here — leave it missing and ask.
When nothing is required is missing, set missingFields to [], nextQuestion to
null, and write a one-sentence summary for them to check.`;
  }

  /** Trust nothing from the model: shape it, or drop it. */
  private normalise(raw: Record<string, unknown>): AiIntakeReply {
    const target =
      typeof raw.target === "string" &&
      (AI_TARGETS as readonly string[]).includes(raw.target)
        ? (raw.target as AiTarget)
        : null;

    const draft =
      raw.draft && typeof raw.draft === "object" && !Array.isArray(raw.draft)
        ? (raw.draft as Record<string, unknown>)
        : {};

    const missingFields = Array.isArray(raw.missingFields)
      ? raw.missingFields.filter((f): f is string => typeof f === "string")
      : [];

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

    const categoryName =
      takeString(out, "categoryId") ?? takeString(out, "categoryName");
    if (categoryName) {
      const [row] = await this.db.client
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.isActive, true),
            or(
              sql`lower(${categories.name}) = ${categoryName.toLowerCase()}`,
              ilike(categories.name, `%${categoryName}%`),
            ),
          ),
        )
        .limit(1);
      if (row) out.categoryId = row.id;
      else {
        delete out.categoryId;
        throw new BadRequestException(
          `There is no category called "${categoryName}". Pick one on the form.`,
        );
      }
    }

    const accountName = takeString(out, "accountName");
    if (accountName) {
      const [row] = await this.db.client
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            isNull(accounts.deletedAt),
            or(
              sql`lower(${accounts.name}) = ${accountName.toLowerCase()}`,
              ilike(accounts.name, `%${accountName}%`),
            ),
          ),
        )
        .limit(1);
      if (row) out.accountId = row.id;
    }

    return out;
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
      description: "The single next question. Omit when nothing is missing.",
    },
    summary: {
      type: "string",
      description:
        "One sentence describing the completed draft, for them to check.",
    },
    clarification: {
      type: "string",
      description: "Ask this when you cannot tell what they are recording.",
    },
  },
  required: ["draft", "missingFields"],
};
