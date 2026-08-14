import {
  createTdsDepositSchema,
  createTeamMemberSchema,
  createTransactionSchema,
  createVendorSchema,
  type AiTarget,
} from "@finance/shared";
import { z } from "zod";

/**
 * The field reference the assistant is given, generated from the schemas the
 * API validates with.
 *
 * The prompt used to list the fields by hand — "transaction_out may also have:
 * billAmount, withheldTaxAmount". Two consequences, both seen in real
 * conversations. The list drifted from the contract, so the model was told
 * about a `vendorName` that had been removed. And because it was a partial
 * list rather than a closed one, the model filled gaps by inventing plausible
 * names: asked to record ten thousand dollars arriving, it produced a
 * `currencyCode` field that does not exist.
 *
 * Generating it from `createTransactionSchema` and friends means the model is
 * told exactly what the endpoint will accept, in the same words, and cannot be
 * told about a field that was deleted — the two cannot drift, because there is
 * only one of them.
 *
 * Only shape is described here. What a field *means*, and the handful of rules
 * no schema can express, stay in the prompt beside this.
 */

/** The create schema behind each thing the assistant can draft. */
const SCHEMAS: Record<AiTarget, z.ZodObject<z.ZodRawShape>> = {
  transaction_out: createTransactionSchema,
  transaction_in: createTransactionSchema,
  vendor: createVendorSchema,
  team_member: createTeamMemberSchema,
  tds_deposit: createTdsDepositSchema,
};

/**
 * Fields the model must never fill in, whatever the schema says.
 *
 * `direction` is set by the app from the target, not by the model — a
 * money-out entry that arrived saying `direction: "in"` would be a wrong
 * figure in the right place. The id fields take uuids the model cannot know;
 * it gives names instead and `resolve()` looks them up.
 */
const NOT_FOR_THE_MODEL = new Set([
  "direction",
  "accountId",
  "categoryId",
  "vendorId",
  "teamMemberId",
  "createdVia",
]);

/** Names the model supplies instead of the ids above. */
const NAME_FIELDS: Record<string, string> = {
  accountName: "the account's name, exactly as listed above",
  categoryName: "the category's name, exactly as listed above",
};

type Described = { name: string; required: boolean; note: string };

export function fieldReferenceFor(target: AiTarget): string {
  const schema = SCHEMAS[target];
  const rows: Described[] = [];

  for (const [name, field] of Object.entries(schema.shape)) {
    if (NOT_FOR_THE_MODEL.has(name)) continue;
    rows.push(describe(name, field as z.ZodType));
  }

  for (const [name, note] of Object.entries(NAME_FIELDS)) {
    if (target.startsWith("transaction") || target === "tds_deposit") {
      rows.push({ name, required: name === "accountName", note });
    }
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  const line = (r: Described) =>
    `  ${r.name.padEnd(width)}  ${r.required ? "REQUIRED" : "optional"}  ${r.note}`;

  return [
    ...rows.filter((r) => r.required).map(line),
    ...rows.filter((r) => !r.required).map(line),
  ].join("\n");
}

/** Every target's fields, for the one prompt that has to cover all of them. */
export function allFieldReferences(): string {
  return (Object.keys(SCHEMAS) as AiTarget[])
    .map((target) => `${target}\n${fieldReferenceFor(target)}`)
    .join("\n\n");
}

/**
 * The rules that hold *between* fields, which the generated list cannot show.
 *
 * `fieldReferenceFor` walks `schema.shape`, and a `.refine()` is not in the
 * shape — it sits outside it, on the object. So every field below reads as
 * "optional" on its own line while the pair of them is mandatory together, and
 * the model has no way to know.
 *
 * That gap was not theoretical. Told "CEO theke 10000 dollar ashche", the
 * assistant filled `originalAmount` and `originalCurrency`, was told the taka
 * that landed, declared the draft complete — and the save came back
 * **400: "A foreign amount needs the rate that converted it"**. Every USD
 * remittance, the one entry where getting the rate right matters most, could be
 * drafted to completion and never filed. A larger model does not fix this; it
 * makes the same draft faster, because the requirement was never written down.
 *
 * Kept beside the generator so a new `.refine()` is at least added in the file
 * whose job is telling the model what the endpoint accepts.
 */
export function pairedFields(): string {
  return `  * originalAmount and fxRate travel together. Give one and you must give
    the other — "A foreign amount needs the rate that converted it". fxRate is
    what the bank actually converted at: taka landed ÷ foreign sent. Ask for it
    rather than working it out, because the rate somebody was given at cash-in
    governs the whole month's reporting. (usdRate is a different, optional
    field — a reference rate for reading taka in dollars, not a conversion that
    happened.)
  * withheldTaxAmount needs billAmount beside it — the gross bill the tax came
    out of — and the bill must cover the amount paid plus that tax.
  * withheldTaxAmount belongs only on money going out.`;
}

/* -------------------------------------------------------------------------- */

type Def = {
  type?: string;
  innerType?: z.ZodType;
  entries?: Record<string, string>;
  checks?: Array<{ _zod?: { def?: Record<string, unknown> } }>;
};

/**
 * One field, in a sentence the model can act on.
 *
 * Unwrapped through `optional`, `default`, `nullable` and `pipe` — a field
 * described as "optional" tells the model nothing about what to put in it, and
 * that is where invented values come from.
 */
function describe(name: string, field: z.ZodType): Described {
  let current = field;
  let required = true;

  // Peel the wrappers, remembering whether any of them made it optional.
  for (let depth = 0; depth < 8; depth += 1) {
    const def = (current as unknown as { def: Def }).def;
    if (!def?.type) break;

    if (def.type === "optional" || def.type === "default") required = false;

    if (
      (def.type === "optional" ||
        def.type === "default" ||
        def.type === "nullable" ||
        def.type === "pipe" ||
        def.type === "union") &&
      def.innerType
    ) {
      current = def.innerType;
      continue;
    }
    break;
  }

  return { name, required, note: shapeOf(name, current) };
}

/** What a value has to look like. */
function shapeOf(name: string, field: z.ZodType): string {
  const def = (field as unknown as { def: Def }).def;

  if (def?.type === "enum" && def.entries) {
    return `one of: ${Object.keys(def.entries).join(" | ")}`;
  }

  /**
   * The three fields that are not taka, named before the money rule below.
   *
   * `originalAmount` is what the sender sent in their own currency, and
   * describing it as taka — which the general amount rule below would — is
   * exactly the confusion that turns a $10,000 transfer into ৳10,000.
   */
  if (name === "originalAmount") {
    return "the FOREIGN amount, e.g. dollars sent. Digits only, 2 decimals.";
  }
  if (name === "originalCurrency")
    return 'the foreign currency code, e.g. "USD"';

  // Case-sensitive on the suffixes: `/On$/i` also matches "descriptiON",
  // which had this describing the description as a date.
  if (/date/i.test(name) || /On$|Until$/.test(name)) {
    return "a date, YYYY-MM-DD";
  }
  if (/^amount$|Amount$|[Ss]alary$/.test(name)) {
    return "digits only, up to 2 decimals, no separators and no minus — e.g. 8500.00. ALWAYS TAKA.";
  }
  if (/[Rr]ate$/.test(name)) return "a number like 122.77";
  if (/email$/i.test(name)) return "an email address";
  if (/url$/i.test(name.toLowerCase())) return "an https:// link";
  if (/etin$/i.test(name)) return "12 digits";
  if (/bin$/i.test(name)) return "13 digits";

  if (def?.type === "number") return "a number";
  if (def?.type === "boolean") return "true or false";
  return "text";
}
