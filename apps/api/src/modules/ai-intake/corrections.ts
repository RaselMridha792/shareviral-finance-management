import {
  AI_TARGET_LABELS,
  type AiIntakeReply,
  type AiTarget,
  type Permission,
} from "@finance/shared";

/**
 * The fields worth learning from, and the only ones kept.
 *
 * An allowlist rather than a blocklist, because the cost of getting this wrong
 * is a salary or a bank balance ending up in somebody else's prompt, and a
 * blocklist is a promise to remember every field anybody adds later.
 *
 * These are the ones that repeat. Which category "DESCO bill" belongs to
 * is true every month; that a particular one was ৳10,400 is true once. Amounts,
 * rates, dates and identifiers are per-entry facts, so leaving them out costs
 * nothing and removes the whole question of what a correction may contain.
 *
 * A plan and its renewal (A2b, 2 Oct 2026) add four of the same kind: which
 * plan on file "Claude Code bill" means, what the tool and the plan are
 * called, and how often it renews are true every month. Its price and its
 * rate are not, and are not here: never money.
 */
export const LEARNABLE_FIELDS = [
  "categoryName",
  "accountName",
  "description",
  "paymentMethod",
  "subscriptionName",
  "toolName",
  "planName",
  "billingCycle",
] as const;

export type LearnableField = (typeof LEARNABLE_FIELDS)[number];

/**
 * What a person must be able to read before they are shown corrections about
 * it.
 *
 * These rows are the one thing in the assistant that carries one person's work
 * into another person's prompt, so they go through the same gate the records
 * themselves do. HR has `ai.use` and not `transactions.read`, and so is never
 * shown how somebody worded a payment.
 */
export const CORRECTION_PERMISSION: Record<AiTarget, Permission> = {
  transaction_in: "transactions.read",
  transaction_out: "transactions.read",
  transfer: "transactions.read",
  // A plan is read with the permission its register asks for; its renewal
  // is a ledger entry.
  subscription: "vendors.read",
  subscription_payment: "transactions.read",
  vendor: "vendors.read",
  team_member: "team.read",
  tds_deposit: "tds.read",
};

/**
 * Digits out of the words somebody typed.
 *
 * The lesson in "office rent diyechi 85000 taka" is *office rent → Office
 * rent*; the 85000 is the part that is nobody else's business. Both Western
 * and Bengali numerals, because people here type both in one sentence.
 */
export function maskDigits(text: string): string {
  return text.replace(/[\d০-৯][\d০-৯,.]*/g, "…");
}

/** One field the person changed, or nothing if they changed nothing. */
export type Correction = {
  field: LearnableField;
  drafted: string | null;
  corrected: string | null;
};

/**
 * What changed between what the assistant drafted and what was saved.
 *
 * Only real edits: a value they left exactly as it was teaches nothing, and
 * filling a field the assistant had rightly left empty is the person adding
 * information rather than correcting a mistake — worth learning too, which is
 * why an absent `drafted` still counts.
 */
export function diffDraft(
  drafted: Record<string, unknown>,
  confirmed: Record<string, unknown>,
): Correction[] {
  const out: Correction[] = [];

  for (const field of LEARNABLE_FIELDS) {
    const before = asText(drafted[field]);
    const after = asText(confirmed[field]);

    if (before === after) continue;
    // Nothing to nothing, in two spellings.
    if (!before && !after) continue;

    out.push({ field, drafted: before, corrected: after });
  }

  return out;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

/**
 * The lessons, written out for the prompt.
 *
 * Phrased as what happened rather than as a rule, because that is what it is —
 * a rule invented from three examples would be applied to a fourth case it does
 * not fit. Showing the correction and letting the model generalise is both
 * honest and, on this evidence, enough.
 */
export function renderCorrections(
  rows: Array<{
    said: string;
    field: string;
    drafted: string | null;
    corrected: string | null;
  }>,
): string {
  if (!rows.length) return "";

  const lines = rows.map((row) => {
    const was = row.drafted ? `you put "${row.drafted}"` : "you left it empty";
    const now = row.corrected ? `"${row.corrected}"` : "empty";
    return `  "${row.said}" → ${row.field}: ${was}, they made it ${now}`;
  });

  return `WHAT THIS COMPANY HAS CORRECTED BEFORE
Real drafts somebody fixed before saving. This is how they file things — follow
it where it fits, and do not treat it as covering a case it plainly does not.
${lines.join("\n")}`;
}

/* -------------------------------------------------------------------------- */
/*  An answer marked wrong (A2b)                                               */
/* -------------------------------------------------------------------------- */

/** Draft keys never written into a mistake, even masked: free text and ids. */
const NOT_RETOLD = new Set(["notes", "note", "renewalNote", "receiptUrl"]);

/**
 * What an answer said or drafted, short enough to sit in a prompt line and
 * on the owner's list: the kind of record, the draft's own fields, and the
 * sentence that was shown.
 *
 * Not masked here: the caller masks what it keeps, with everything else.
 */
export function describeReply(reply: AiIntakeReply): string {
  const parts: string[] = [];

  if (reply.target) {
    const fields = Object.entries(reply.draft ?? {})
      .filter(
        ([key, value]) =>
          !NOT_RETOLD.has(key) &&
          !/Id$/.test(key) &&
          (typeof value === "string" || typeof value === "number") &&
          String(value).trim(),
      )
      .slice(0, 8)
      .map(([key, value]) => `${key} "${String(value).trim().slice(0, 60)}"`);
    parts.push(
      `drafted ${AI_TARGET_LABELS[reply.target].toLowerCase()} (${reply.target})${
        fields.length ? `: ${fields.join(", ")}` : ""
      }`,
    );
  } else if (reply.batch) {
    parts.push(
      `proposed ${reply.batch.rows.length} rows of ${reply.batch.target}`,
    );
  } else if (reply.importPlan) {
    parts.push(
      `planned a file for Import into ${reply.importPlan.accountName}`,
    );
  }

  const shown = reply.nextQuestion ?? reply.clarification ?? reply.summary;
  if (shown) parts.push(`said "${shown.replace(/\s+/g, " ").trim()}"`);

  return parts.join("; ") || "gave no answer";
}

/**
 * The answers somebody marked wrong, written out for the prompt.
 *
 * Kept apart from the drafts fixed before Save: those say how a field is
 * filed, these say an answer as a whole was not right, in the person's own
 * words, and the model is asked not to give it again.
 */
export function renderReplyMistakes(
  rows: Array<{
    said: string;
    drafted: string | null;
    corrected: string | null;
  }>,
): string {
  if (!rows.length) return "";

  const lines = rows.map(
    (row) =>
      `  "${row.said}" → you ${row.drafted ?? "answered"}. They said: ${row.corrected ?? "(no reason given)"}`,
  );

  return `ANSWERS SOMEBODY HERE MARKED WRONG
Real answers of yours a person said were wrong, with what they said was
right. Do not give the same answer to the same kind of request. Where what
was right says where a thing belongs or how it is filed, follow it; where it
only says a figure was off, look the figure up instead of repeating it.
${lines.join("\n")}`;
}

/**
 * The line "Make this a rule" offers the owner, to change before saving it.
 *
 * Their instructions are one rule a line, in their own words, so this is
 * only a starting point: what was asked, and what was right.
 */
export function proposedRule(row: {
  kind: string;
  said: string;
  field: string | null;
  corrected: string | null;
}): string {
  const said = row.said.replace(/\s+/g, " ").trim().slice(0, 120);
  if (row.kind === "field" && row.field) {
    const field = row.field.replace(/Name$/, "").replace(/([A-Z])/g, " $1");
    return `"${said}" → ${field.toLowerCase().trim()}: ${row.corrected ?? "leave it empty"}`;
  }
  return `"${said}": ${row.corrected ?? ""}`.trim();
}
