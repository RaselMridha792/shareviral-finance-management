import type { AiTarget, Permission } from "@finance/shared";

/**
 * The fields worth learning from, and the only ones kept.
 *
 * An allowlist rather than a blocklist, because the cost of getting this wrong
 * is a salary or a bank balance ending up in somebody else's prompt, and a
 * blocklist is a promise to remember every field anybody adds later.
 *
 * These four are the ones that repeat. Which category "DESCO bill" belongs to
 * is true every month; that a particular one was ৳10,400 is true once. Amounts,
 * rates, dates and identifiers are per-entry facts, so leaving them out costs
 * nothing and removes the whole question of what a correction may contain.
 */
export const LEARNABLE_FIELDS = [
  "categoryName",
  "accountName",
  "description",
  "paymentMethod",
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
