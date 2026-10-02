import type { AiTarget, Permission } from "@finance/shared";
import type { z } from "zod";

/**
 * The map of the application, as the Assistant is given it (2 Oct 2026).
 *
 * The owner told the Assistant to buy an AI subscription and it recorded a
 * plain payment: All transactions showed the entry and the AI tools and
 * subscriptions page showed nothing. It was not short of intelligence. It had
 * never been told that page exists, what is kept there, or that a plan is a
 * different record from a payment. "Or kache puro application er knowledge
 * thakle o vul kom korbe."
 *
 * So each part of the app says, in a file beside its own module
 * (`<module>/app-map.ts`): what it is for, which records belong there and not
 * in the plain ledger, which screen and which endpoint record them, and what
 * the Assistant may do there — draft, read, or only point to the screen.
 * `ai-intake/app-map.ts` gathers them, and its test fails when a module has
 * no entry, when an entry names a screen or an endpoint that does not exist,
 * and when a kind of draft or a look-up tool belongs to no part.
 *
 * Written by reading each module, not from memory. When a screen is added,
 * moved or retired, its entry is the place that has to change with it.
 */

export type AppScreen = {
  /** Its address, as the rail has it. `[id]` stands for one record's own. */
  href: string;
  /** What the rail, or the page itself, calls it. */
  name: string;
  /** What is seen there and what can be done there. */
  does: string;
};

/**
 * A form a person fills in, or a button that changes something without one
 * (2 Oct 2026, piece A2b: "kon forms ta kivabe kaj kore").
 *
 * The field list is not written here. It is generated from `schema`, the
 * same schema the API validates the request with, so the map cannot tell
 * the Assistant about a field Save would refuse, or leave out one it needs.
 * What is written by hand is what no schema says: what a field means, how
 * the form is opened, and what happens when it is saved.
 *
 * `ai-intake/app-map.spec.ts` fails when an endpoint that changes something
 * is named by no form (or put on `NOT_A_FORM` with the reason), when a form
 * names an endpoint no controller declares, or explains a field its schema
 * does not have.
 */
export type AppForm = {
  /** What it is called on screen: the popup's title, or the button's label. */
  name: string;
  /** The screen it is on: an `href` of a screen on the map. */
  on: string;
  /** How it is opened: "Add subscription, top right", "Renew, on a plan's row". */
  opens: string;
  /** The requests its Save sends, in order: "POST /subscriptions". */
  saves: readonly string[];
  /**
   * The schema the API validates the request body with. Left out for a
   * button that sends nothing to fill in (Archive, Finalize), or where the
   * endpoint reads no schema; `fields` then names what is asked, by hand.
   */
  schema?: z.ZodType;
  /**
   * What a field means, where its name does not say it. With a schema, only
   * the schema's own keys; without one, every field the form asks for.
   */
  fields?: Readonly<Record<string, string>>;
  /** What Save does: what is written, what moves, and where it then shows. */
  onSave: string;
  /** The permission it needs, where that is not the part's own. */
  permission?: Permission;
  /** The kind of record the Assistant drafts for this form, if it drafts one. */
  draft?: AiTarget;
};

/**
 * What a part takes from the plain ledger: a draft of one of `from` that
 * reads like this is not a plain entry, it is this part's record.
 *
 * Checked in code after the model has answered (`ai-intake/routing.ts`), so
 * the model's care is not the only thing between a mistake and the books.
 */
export type AppClaim = {
  /** The kinds of draft this is looked for on. */
  from: readonly AiTarget[];
  /** A category, or the heading above it, whose name reads like this. */
  categories?: RegExp;
  /** These words in what was typed, or in the draft's own text. */
  words?: RegExp;
  /** A vendor being drafted as one of these types. */
  vendorTypes?: readonly string[];
  /** Said to the person when the draft is refused: what it is, and the question. */
  say: string;
  /**
   * Said when that was already what they were told last and the same draft
   * came back: plainly what cannot be done, and the way round it. The same
   * question a second time teaches nobody anything.
   */
  sayAgain: string;
  /** Said of an attached file whose rows this part claims: Import takes plain entries only. */
  sayOfAFile: string;
};

export type AppPart = {
  /** Its name in the Assistant's answer (`area`). Never shown to a person. */
  key: string;
  /** What the app itself calls it. */
  name: string;
  /** The folders under `modules/` this part speaks for. */
  modules: readonly string[];
  /** What it is for. */
  purpose: string;
  /** Which records belong here — and not in the plain ledger. */
  keeps: readonly string[];
  /** Where a person does it. Empty when no screen shows it. */
  screens: readonly AppScreen[];
  /**
   * Every form and every button of this part that changes something. Empty
   * where nothing is changed (a report). See `AppForm`.
   */
  forms: readonly AppForm[];
  /** What records it: "POST /subscriptions". Empty when nothing is recorded here. */
  recordedBy: readonly string[];
  /** What a person needs to open it; null when everybody signed in may. */
  permission: Permission | null;
  assistant: {
    /** The kinds of record it can draft here, for the person to save. */
    drafts: readonly AiTarget[];
    /** The look-up tools that read this part. */
    reads: readonly string[];
    /**
     * What it says to anything else asked of this part: what it cannot do
     * here, and where the person does it. It never files such a thing as a
     * plain payment instead.
     */
    otherwise: string;
    /**
     * Set where its drafts are made one at a time and never as a table of
     * rows: what is said to somebody who asked for several at once. A table's
     * rows are saved as written, without the draft's check — and here the
     * check is what finds the plan a name means.
     */
    oneAtATime?: string;
  };
  claims?: AppClaim;
};

/** Written out so each module's file reads as data and is checked as it is typed. */
export function appPart(part: AppPart): AppPart {
  return part;
}
