import Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AI_TARGETS,
  AI_TARGET_LABELS,
  todayInDhaka,
  type AiAvailability,
  type AiIntakeReply,
  type AiIntakeRequest,
  type AiTarget,
} from "@finance/shared";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { accounts, categories, vendors } from "../../db/schema";

/** Small, fast, and entirely adequate for filling in a form. */
const MODEL = "claude-sonnet-5";

@Injectable()
export class AiIntakeService {
  private readonly log = new Logger(AiIntakeService.name);
  private client: Anthropic | null = null;

  constructor(private readonly db: DbService) {}

  availability(): AiAvailability {
    if (!process.env.ANTHROPIC_API_KEY) {
      return {
        configured: false,
        reason:
          "No ANTHROPIC_API_KEY is set on the API, so the assistant cannot run. Everything it would do can be done on the ordinary forms.",
      };
    }
    return { configured: true, reason: null };
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
  async turn(input: AiIntakeRequest): Promise<AiIntakeReply> {
    const client = this.anthropic();
    const context = await this.context();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: this.systemPrompt(context, input.target, input.draft),
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: [
        {
          name: "draft",
          description:
            "Record what you have understood so far and the next question to ask.",
          input_schema: REPLY_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "draft" },
    });

    const block = response.content.find((c) => c.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new ServiceUnavailableException(
        "The assistant did not answer in the expected shape. Try the ordinary form.",
      );
    }

    return this.normalise(block.input as Record<string, unknown>);
  }

  /* ---------------------------------------------------------------------- */

  private anthropic(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ServiceUnavailableException(
        "The assistant is not configured. Ask a Super Admin to add an ANTHROPIC_API_KEY, or use the ordinary form.",
      );
    }
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return this.client;
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
    target?: AiTarget,
    draft?: Record<string, unknown>,
  ): string {
    return `You help someone record a finance entry in ShareViral Finance Management, a Bangladesh company's internal books. You fill in a form. You do not save anything — the person reviews and confirms every draft on an ordinary form afterwards.

Today in Dhaka is ${todayInDhaka()}. The currency is BDT unless the person says otherwise.

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

transaction_out may also have: vendorName, billAmount, withheldTaxAmount
  (tax withheld only applies to money going out — never to money coming in)

vendor: name. May also have: type, etin, bin
team_member: fullName, employeeCode, joinedOn. Never ask about salary — it is
  not recorded here and you must not collect it.
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
