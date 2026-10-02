import {
  AI_TARGET_LABELS,
  AI_TARGET_PERMISSION,
  hasPermission,
  type AiTarget,
  type StoredRole,
} from "@finance/shared";

import type { AppPart } from "../../common/app-map";
import { APP_MAP, partOf, partsDrafting } from "./app-map";
import { planLabels, type PlanOnFile } from "./draft-check";

/**
 * Routing: which part of the app a draft belongs to, decided against the
 * map and not left to the model (2 Oct 2026).
 *
 * The prompt tells the model to choose the part first and to draft only what
 * that part keeps. This is for the answer that does not: the owner's case, a
 * subscription drafted as a plain payment. A plain payment is always
 * saveable — the ledger takes anything with an account, an amount and a
 * category — so nothing downstream would ever have refused it. It showed on
 * All transactions and not on the page it belonged to.
 *
 * Three refusals, in this order:
 *
 *   1. the person's role could not save this kind of record;
 *   2. another part of the map claims it: its category, its own words or its
 *      type say it is that part's record and not a plain one;
 *   3. the model itself named a part where nothing can be drafted, or one
 *      that claims this kind of draft, and drafted it anyway.
 *
 * A refusal is first told to the model, once, so it can answer again with
 * the right kind of record (`tell`). If it still does not, the draft is
 * dropped and the person is told where the thing belongs (`say`). Nothing
 * here reads the database: what the books hold is handed in.
 */

export type RouteContext = {
  /** The role of the person asking: a draft they could not save is not offered. */
  role: StoredRole;
  /** What they typed last. */
  said: string;
  /**
   * Whether a draft was already on the table when they typed it. What was
   * typed is read for a part's words only on a new request: an answer to a
   * question about a draft — "na, eta subscription na" — is about the draft,
   * and must not be what takes it away.
   */
  draftOpen: boolean;
  /** What the assistant said last, so a refusal is not repeated word for word. */
  lastAnswer: string | null;
  /**
   * The categories the draft's category name could mean in the books: each
   * one's own name and the heading above it. Empty when it names none.
   */
  categories: Array<{ name: string; heading: string | null }>;
};

export type Refusal = {
  /** The part the request belongs to. */
  part: AppPart;
  /** Said to the person when the draft is dropped. */
  say: string;
  /** Said to the model first, so it can answer again. */
  tell: string;
};

type Drafted = {
  area?: string | null;
  target: AiTarget | null;
  draft: Record<string, unknown>;
};

/** Why this draft is not offered, or null when it may be. */
export function refusalOf(
  reply: Drafted,
  context: RouteContext,
): Refusal | null {
  const target = reply.target;
  if (!target) return null;
  const home = partsDrafting(target)[0] ?? APP_MAP[0];

  const lacking = AI_TARGET_PERMISSION[target].filter(
    (permission) => !hasPermission(context.role, permission),
  );
  if (lacking.length) {
    const say = `Your role cannot record ${AI_TARGET_LABELS[target].toLowerCase()}, so I cannot draft one for you. Somebody whose role can will have to enter it.`;
    return {
      part: home,
      say,
      tell: `Refused by the app: this person's role cannot save a ${target} (it lacks ${lacking.join(", ")}). Do not draft one. Answer again with 'target' left out, 'draft' empty, and this in 'summary', in their own register: "${say}"`,
    };
  }

  const claimed = claimOn(target, reply.draft, context);
  if (claimed) return claimed;

  /*
   * The part the model itself named. Two answers are refused on it:
   *
   * - a part where nothing can be drafted — it judged this to be Payroll's,
   *   or Settings', and drafted a payment anyway;
   * - a part that claims this kind of draft — it judged this to be a
   *   subscription, and drafted a plain payment anyway.
   *
   * Any other mismatch is a slip in the name and not in the record: a
   * transfer said to belong to "transactions" is still a sound transfer, and
   * dropping a draft somebody has answered five questions about, over a
   * label, would be the code being wrong on the model's behalf. `areaOf`
   * reports such a draft under its own home.
   */
  const named = partOf(reply.area);
  if (!named || named.assistant.drafts.includes(target)) return null;

  if (!named.assistant.drafts.length) {
    const say = named.assistant.otherwise;
    return {
      part: named,
      say,
      tell: `Refused by the app: you said this belongs to [${named.key}] ${named.name}, where you cannot draft anything. Do not draft a ${target} in its place. Answer again with 'target' left out, 'draft' empty, and this in 'summary', in their own register: "${say}"`,
    };
  }
  if (named.claims?.from.includes(target)) {
    const say = sayOf(named, context);
    return {
      part: named,
      say,
      tell: `Refused by the app: you said this belongs to [${named.key}] ${named.name}, which keeps ${named.assistant.drafts.join(" and ")} and never a ${target}. Answer again with a draft of one of those, if you can tell which it is. If you cannot, leave 'target' out and ask: "${named.claims.say}"`,
    };
  }

  return null;
}

/**
 * The refusal of a draft another part claims, or null.
 *
 * On its own because a file's import plan is held to it too: its rows become
 * plain payments, and a file of subscriptions is no more a file of plain
 * payments than one subscription is.
 */
export function claimOn(
  target: AiTarget,
  draft: Record<string, unknown>,
  context: RouteContext,
): Refusal | null {
  const claimant = claimantOf(target, draft, context);
  if (!claimant?.claims) return null;

  const kinds = claimant.assistant.drafts.join(" or ");
  return {
    part: claimant,
    say: sayOf(claimant, context),
    tell: `Refused by the app: under THE MAP this belongs to [${claimant.key}] ${claimant.name}, and is never a ${target}. ${claimant.keeps.join(" ")} Answer again with 'area' "${claimant.key}"${kinds ? ` and a draft of ${kinds}, if you can tell which it is. If you cannot, leave 'target' out and ask` : ", 'target' left out, and say"}: "${claimant.claims.say}"`,
  };
}

/**
 * The refusal of a table of rows, for a kind of record that is drafted one
 * at a time — or null.
 *
 * A row of a table is not put through the draft's check; it is saved as it
 * was written. For a plan and its renewal that would skip everything the
 * check is for: which plan a name means, and this renewal's own rate.
 */
export function tableRefusalOf(target: AiTarget): Refusal | null {
  const part = partsDrafting(target).find((one) => one.assistant.oneAtATime);
  const say = part?.assistant.oneAtATime;
  if (!part || !say) return null;
  return {
    part,
    say,
    tell: `Refused by the app: a ${target} is never proposed in 'batch'. Each is drafted on its own, in 'draft', so that it is checked against what is on file. Answer again with the first one as 'draft', and say in 'nextQuestion' which are still to come.`,
  };
}

/**
 * The part an answer belongs to, for the reply: the one the model named when
 * it fits what was drafted, otherwise the draft's own home.
 */
export function areaOf(reply: Drafted): string | null {
  const named = partOf(reply.area);
  if (!reply.target) return named?.key ?? null;
  if (named?.assistant.drafts.includes(reply.target)) return named.key;
  return partsDrafting(reply.target)[0]?.key ?? null;
}

/**
 * What the person is told. The part's own sentence — and, when that sentence
 * is what they were told last and the draft is the same again, the plainer
 * one after it: asked the same question twice, nobody learns anything new.
 */
function sayOf(part: AppPart, context: RouteContext): string {
  const claims = part.claims;
  if (!claims) return part.assistant.otherwise;
  const again =
    context.lastAnswer !== null &&
    (context.lastAnswer.includes(claims.say) ||
      context.lastAnswer.includes(claims.sayAgain));
  return again ? claims.sayAgain : claims.say;
}

/** A value with its dress off: "AI Tool", "ai-tool" and "ai_tool" are one. */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The part that takes this draft out of the plain ledger, if one does. */
function claimantOf(
  target: AiTarget,
  draft: Record<string, unknown>,
  context: RouteContext,
): AppPart | null {
  const written = Object.values(draft).filter(
    (value): value is string => typeof value === "string",
  );
  const type = typeof draft.type === "string" ? draft.type : null;
  const category =
    typeof draft.categoryName === "string" ? draft.categoryName : null;

  return (
    APP_MAP.find((part) => {
      const claims = part.claims;
      if (!claims || !claims.from.includes(target)) return false;

      // However it was written: "AI Tool" is the type `ai_tool`.
      if (
        target === "vendor" &&
        type &&
        claims.vendorTypes?.some((kind) => plain(kind) === plain(type))
      ) {
        return true;
      }

      const reads = claims.categories;
      if (reads) {
        // The name as written says so by itself,
        if (category && reads.test(category)) return true;
        // or every category it could mean in the books does — by its own
        // name or by the heading it sits under. A name that fits several,
        // only some of them this part's, is not this part's yet: the draft's
        // check asks which, and the answer is read again.
        if (
          context.categories.length &&
          context.categories.every(
            (one) => reads.test(one.name) || reads.test(one.heading ?? ""),
          )
        ) {
          return true;
        }
      }

      const heard = context.draftOpen ? written : [context.said, ...written];
      return Boolean(
        claims.words && heard.some((text) => claims.words?.test(text)),
      );
    }) ?? null
  );
}

/**
 * A plan on file that a plain payment names: "Claude er bill dilam".
 *
 * Not a refusal. A tool's name is also an ordinary word — a payment to
 * Google for advertising is not the Google Workspace plan — so this is said
 * beside the draft and the person decides. Whole words only, and a name of
 * three letters or more.
 */
export function planNamedIn(
  plans: PlanOnFile[],
  /** What was typed and what the draft says. Anything not text is passed over. */
  texts: unknown[],
): string | null {
  const labels = planLabels(plans);
  const text = texts
    .filter((one): one is string => typeof one === "string")
    .join(" \n ")
    .toLowerCase();
  if (!text.trim()) return null;

  const found = plans.find((plan) => {
    const name = plan.toolName.trim().toLowerCase();
    if (name.length < 3) return false;
    if (plan.status !== "active" && plan.status !== "paused") return false;
    const at = text.indexOf(name);
    if (at === -1) return false;
    const before = text[at - 1];
    const after = text[at + name.length];
    const letter = /[a-z0-9]/;
    return !(before && letter.test(before)) && !(after && letter.test(after));
  });
  return found ? (labels.get(found.id) ?? found.toolName) : null;
}
