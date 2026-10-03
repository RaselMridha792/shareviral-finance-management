import type { AiOpenField, AiTarget } from "@finance/shared";

import type { WorthAsking } from "../../common/app-map";
import type { DraftProblem } from "./draft-check";

/**
 * Every field asked at once (4 Oct 2026).
 *
 * The owner had the Assistant buy a Claude plan. The plan was saved, and its
 * row on AI tools and subscriptions read "N/A" for Invoice, Reference, Login
 * accounts, User name and User department: the Assistant asked only for what
 * the schema requires, one question at a time, and these never came up.
 * "Onekgula field se faka rekheche and oi somporke amakeo jigges korenai …
 * sobgula field somporke ekebarei jigges kore ney."
 *
 * So once the kind of record is known, what is still open is asked in one
 * message, as a short list: what Save needs first, then what the page shows
 * and the owner expects filled (the app map's `worthAsking`). "Skip" leaves
 * one empty on purpose, and it is not asked again. A choice between real
 * names is still asked on its own (`DraftProblem.choice`), since the rest
 * may hang on it.
 *
 * Nothing here reads the database or the model's words: it is handed what
 * the draft's check found, so the rules can be tested as they are.
 */

/** How the list ends, and how an answer to it is known. */
export const SKIP_LINE = "Say skip for any you want left empty.";

/** A message that is nothing but "leave the rest empty". */
const SKIP_ALL =
  /^\s*(?:(?:baki\s*gula|baaki\s*gula|baki|baaki|sob\s*gula|sob|all|the rest|rest|everything|egula|ogula)\s+)?(?:skip|nai|nei|none|nothing|lagbe na|lagbena|dorkar nai|dorkar nei|khali rakho|faka rakho)(?:\s+(?:all|sob|sobgula|baki|bakigula|the rest|everything|koro|kore dao|dao))?\s*[.!।]*\s*$/i;

/**
 * True when the whole message says to leave every open field empty. Read
 * only as the answer to the list (`SKIP_LINE`): "nai" after "is this a
 * renewal?" is an answer to that, not a skip.
 */
export function skipsAll(text: string): boolean {
  return SKIP_ALL.test(text);
}

export type OpenFieldsInput = {
  target: AiTarget;
  /** The checked draft: what is on the card. */
  draft: Record<string, unknown>;
  /** What the draft's check refused or found missing. */
  problems: readonly DraftProblem[];
  /** Every field still wanted, the check's and the model's, in ask order. */
  missing: readonly string[];
  /** What the form's page shows and the owner expects filled. */
  worth: readonly WorthAsking[];
  /** Left empty on purpose, this turn or before. */
  skipped: ReadonlySet<string>;
  /** A plan's invoice is attached in the chat. */
  invoiceGiven: boolean;
  /** The page's word for a field Save needs. */
  labelOf: (field: string) => string;
  /** What is asked for a field Save needs, when nothing more specific is. */
  askFor: (field: string) => string;
};

/**
 * The fields the card shows empty: what Save still needs, then what is worth
 * asking, those left empty on purpose marked so. A worth-asking field the
 * check refused a value for is still worth asking, with the refusal as its
 * question; it never becomes one Save needs.
 */
export function openFieldsOf(input: OpenFieldsInput): AiOpenField[] {
  const { draft, problems, worth, skipped } = input;
  const worthFields = new Set(worth.map((one) => one.field));
  const given = (field: string) =>
    field === "invoice"
      ? input.invoiceGiven
      : typeof draft[field] === "string" && draft[field] !== "";
  const problemOf = (field: string) =>
    problems.find((problem) => problem.field === field)?.question;

  const required: AiOpenField[] = input.missing
    .filter((field) => !worthFields.has(field))
    .map((field) => ({
      field,
      label: input.labelOf(field),
      ask: problemOf(field) ?? input.askFor(field),
      required: true,
    }));

  const worthOpen: AiOpenField[] = worth
    .filter((one) => !given(one.field))
    .filter((one) => !one.onlyWith || given(one.onlyWith))
    .map((one) => ({
      field: one.field,
      label: one.shows,
      ask: problemOf(one.field) ?? one.ask,
      required: false,
      ...(one.file ? { file: true } : {}),
      ...(skipped.has(one.field) ? { skipped: true } : {}),
    }));

  return [...required, ...worthOpen];
}

/** What is still to be answered: the open fields not left empty on purpose. */
export function stillAsked(open: readonly AiOpenField[]): AiOpenField[] {
  return open.filter((field) => !field.skipped);
}

/**
 * The list, as the chat says it: a line a field, by the page's own heading,
 * and how to answer. One message, so they answer all of it in one.
 */
export function askingLines(asked: readonly AiOpenField[]): string {
  const lines = asked.map((field) => `• ${field.label} — ${field.ask}`);
  const optional = asked.some((field) => !field.required);
  return [
    ...lines,
    "",
    optional
      ? `Answer them all in one message. ${SKIP_LINE}`
      : "Answer them all in one message.",
  ].join("\n");
}

/** The opening line when the model gave none of its own. */
export function askingLead(asked: readonly AiOpenField[]): string {
  return asked.some((field) => field.required)
    ? "To finish this, I still need:"
    : "Before it is saved, these are still empty on the page:";
}
