import type { AiTarget } from "@finance/shared";
import type { z } from "zod";

import {
  NAME_FIELDS,
  TARGET_SCHEMAS,
  forTheModel,
  isStandIn,
  nameFieldsFor,
  type NameField,
} from "./field-reference";

/**
 * A draft, put through the schema its Save will use — before it is offered.
 *
 * Whether a draft was complete used to be the model's word. The prompt asked
 * it to list what was missing, `normalise()` believed an empty list, and the
 * page offered Save. Claude kept to that. Gemini, on the live site on 2 Oct
 * 2026, returned a payment with no category and nothing listed as missing,
 * and the owner pressed Save on a form that could only answer "Invalid input:
 * expected string, received undefined: Category".
 *
 * So the question is asked of the code, for every model: the draft is taken
 * exactly as the card will send it, its names are turned into ids against the
 * books, and it is parsed with the endpoint's own schema. Whatever that
 * refuses is a question to ask, not a form to offer.
 *
 * Nothing here reads the database: what the books hold under each name is
 * handed in, so the rules can be tested as they are.
 */

/** One account, category or plan a name in the draft could mean. */
export type NameMatch = {
  id: string;
  name: string;
  /** An account's own: "USD" marks the account kept for foreign spend. */
  currency?: string | null;
  /**
   * A plan's own: what one cycle costs in dollars (its price and the
   * vendor's charge on top), the rate that price was struck at, and the
   * account it is paid from. What the Renew drawer offers before anybody
   * types; a renewal's draft is filled from the same.
   */
  plan?: {
    payableUsd: string | null;
    usdRate: string | null;
    account: NameMatch | null;
  };
};

/** A plan on file, as far as telling two apart needs. */
export type PlanOnFile = {
  id: string;
  toolName: string;
  planName: string;
  status: string;
  /**
   * What tells two plans of one tool and one name apart: who it was bought
   * for, or failing that the day it started. A seat each for two people is
   * two rows that are otherwise the same.
   */
  hint?: string | null;
};

export type NameMatches = Partial<Record<NameField["name"], NameMatch[]>>;

/**
 * The people on Team each name in a plan's `userNames` could be, by the
 * name as it was said, in lower case (4 Oct 2026).
 */
export type PeopleMatches = Record<string, NameMatch[]>;

export type DraftProblem = {
  /** The draft's own key for it: `categoryName`, never `categoryId`. */
  field: string;
  /** Asked when the model has no question of its own. */
  question: string;
  /**
   * A choice between real names — two accounts called alike, two people of
   * one name — or between a renewal and a new plan. Asked on its own, before
   * anything else (4 Oct 2026): the rest of the list can wait for it.
   */
  choice?: boolean;
};

export type CheckedDraft = {
  /** What the card shows: text values, real names, nothing Save would refuse. */
  draft: Record<string, unknown>;
  /** Empty when the endpoint's schema accepts the draft as it stands. */
  problems: DraftProblem[];
  /**
   * Said beside a draft that can be saved: something the books hold that
   * the person should know before they press Save. Never a refusal.
   */
  notes: string[];
  /**
   * What Save sends, as the record's endpoint takes it: ids for the names,
   * and the keys the app adds itself. Only worth sending when `problems` is
   * empty — Confirm and save (A4) sends exactly this to the record's own
   * service, after its own schema has parsed it once more.
   */
  body: Record<string, unknown>;
};

/* -------------------------------------------------------------------------- */
/*  The draft, as the card will hold it                                        */
/* -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const FIGURE_KEY = /^amount$|Amount$|[Rr]ate$|^chargeUsd$|^cost(?:Usd|Bdt)$/;
/** 4,500 and 1,250,000.50 — and 1,00,000, the way a lakh is written here. */
const GROUPED = /^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/;

/** The figures that are dollars. Every other amount is taka. */
const DOLLAR_KEY = /^usdAmount$|^chargeUsd$|^originalAmount$|^costUsd$/;

/**
 * A figure with its dressing off: its own currency's sign, the spaces, and
 * the commas — but only commas that are plainly grouping. "121,5" is left as
 * it was typed, to be refused and asked about: read as grouping it would be a
 * rate of 1215.
 *
 * Its OWN sign only. "$100" in a taka box is a hundred dollars, not a hundred
 * taka; the sign stays on, the schema refuses it, and the person is asked.
 */
function bareFigure(key: string, text: string): string {
  const plain = text.replace(DOLLAR_KEY.test(key) ? /[\s$]/g : /[\s৳]/g, "");
  return GROUPED.test(plain) ? plain.replace(/,/g, "") : plain;
}

/**
 * Every value as text, the way the card's boxes hold it and send it.
 *
 * A model sends `100000` where the schema wants "100000"; the card turns it
 * into text before Save, so a check on the bare number would refuse a draft
 * that saves perfectly well. A name that arrived in an id's key is moved to
 * the name's; an id the model wrote is dropped — it cannot know one, and a
 * guessed id that happens to exist files money against an unrelated record.
 */
export function tidyDraft(
  draft: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(draft)) {
    // A list of names, sent as one: "Rasel, Nizam" is how the card holds it.
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      const joined = value
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");
      if (joined) out[key] = joined;
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number") {
      if (typeof value === "boolean") out[key] = String(value);
      continue;
    }
    const text = String(value).trim();
    if (!text) continue;
    out[key] = FIGURE_KEY.test(key) ? bareFigure(key, text) : text;
  }

  for (const field of NAME_FIELDS) {
    const inIdKey = out[field.id];
    if (inIdKey === undefined) continue;
    delete out[field.id];
    if (!UUID.test(inIdKey) && out[field.name] === undefined) {
      out[field.name] = inIdKey;
    }
  }

  for (const field of NAME_FIELDS) {
    const name = bareName(out[field.name]);
    if (name) out[field.name] = name;
    else delete out[field.name];
  }

  return out;
}

/** The names in a draft that have to be found in the books. */
export function namesIn(
  target: AiTarget,
  draft: Record<string, string>,
): Array<{ field: NameField; said: string }> {
  return nameFieldsFor(target).flatMap((field) =>
    draft[field.name] ? [{ field, said: draft[field.name] }] : [],
  );
}

/**
 * The name, with any annotation the model copied along with it removed.
 *
 * The prompt lists a category as "Electricity  —  money out" and a dollar
 * account as "Master card  —  dollar account", and a model asked for "the
 * name" sometimes returns the whole line. Refusing that is technically
 * correct and useless: the conversation had reached a complete draft and
 * simply could not be saved. Trimming what the prompt itself added is not
 * guesswork — it is undoing our own formatting.
 *
 * A dash inside a real name survives, because only a spaced em-dash separator
 * and a trailing parenthetical are removed.
 */
export function bareName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return (
    value
      .split(/\s+—\s+/)[0]
      .replace(/\s*\((?:in|out|both|money in|money out|either)\)\s*$/i, "")
      .trim() || undefined
  );
}

/* -------------------------------------------------------------------------- */
/*  Which category a name means                                                */
/* -------------------------------------------------------------------------- */

/**
 * Between a heading and the sub-category under it: "Office › Rent".
 *
 * A name is unique among its siblings only — "Rent" may sit under both Office
 * and Equipment — so two sub-categories can share one. Asked "Rent or Rent?",
 * nobody can answer. The two are told apart by their heading, in the list the
 * model is given, in the question, and on the card; and a name written that
 * way is read back as that heading's.
 */
const UNDER = " › ";

export type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
};

const sameName = (a: string | null, b: string) =>
  (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** "Office › Rent" is the sub-category "Rent", under the heading "Office". */
export function underHeading(said: string): {
  heading: string | null;
  leaf: string;
} {
  const parts = said.split(/\s*[›>]\s*/).filter(Boolean);
  return parts.length > 1
    ? { heading: parts[0], leaf: parts[parts.length - 1] }
    : { heading: null, leaf: said.trim() };
}

/** How each sub-category is written, so that no two read the same. */
export function categoryLabels(rows: CategoryRow[]): Map<string, string> {
  return new Map(
    rows.map((row) => [
      row.id,
      row.parentName &&
      rows.filter((other) => sameName(other.name, row.name)).length > 1
        ? `${row.parentName}${UNDER}${row.name}`
        : row.name,
    ]),
  );
}

/**
 * The categories a name could mean, from every one whose name contains it.
 *
 * The one spelled exactly so wins over those that merely contain it. A
 * payment is filed against a sub-category, so among several a heading gives
 * way: local "Office rent" is a heading and a sub-category both. What is left
 * is every candidate — one is an answer, more is a question.
 */
export function categoryMatches(
  rows: CategoryRow[],
  said: string,
): NameMatch[] {
  const { heading, leaf } = underHeading(said);
  const exact = rows.filter((row) => sameName(row.name, leaf));
  const pool = exact.length ? exact : rows;
  const leaves = pool.filter((row) => row.parentId !== null);
  const kept = leaves.length ? leaves : pool;
  const labels = categoryLabels(kept);

  return kept
    .filter((row) => !heading || sameName(row.parentName, heading))
    .map((row) => ({ id: row.id, name: labels.get(row.id) ?? row.name }));
}

/* -------------------------------------------------------------------------- */
/*  Which plan a name means                                                    */
/* -------------------------------------------------------------------------- */

/** Still being paid for: the plans a renewal or a new plan can be mistaken for. */
const running = (plan: PlanOnFile) =>
  plan.status === "active" || plan.status === "paused";

/**
 * How each plan is written, so that no two read the same: the tool; its
 * plan as well where one tool has several — "ChatGPT › Plus" beside
 * "ChatGPT › Team"; and, where two rows are the same tool and the same plan,
 * what tells them apart — "ChatGPT › Plus (Rahim)".
 */
export function planLabels(rows: PlanOnFile[]): Map<string, string> {
  return new Map(
    rows.map((row) => {
      const ofTool = rows.filter((other) =>
        sameName(other.toolName, row.toolName),
      );
      if (ofTool.length < 2) return [row.id, row.toolName];

      const written = `${row.toolName}${UNDER}${row.planName}`;
      const twins = ofTool.filter((other) =>
        sameName(other.planName, row.planName),
      );
      return [
        row.id,
        twins.length > 1 && row.hint ? `${written} (${row.hint})` : written,
      ];
    }),
  );
}

/**
 * The plans a name means: the ones called exactly that.
 *
 * As the list writes it, the tool's own name, or the tool and its plan
 * together ("Claude Max"). Nothing looser. A renewal is money against a
 * plan, and a name that merely resembles one — "Claude Code" beside a plan
 * called Claude, "GitHub" beside one called Git — must be a question and
 * never an answer: see `plansLike`. A plan still running wins over one that
 * was cancelled or has expired. One is an answer, more is a question.
 */
export function plansNamed<T extends PlanOnFile>(rows: T[], said: string): T[] {
  const labels = planLabels(rows);
  const { heading: tool, leaf } = underHeading(said);

  const exact = rows.filter(
    (row) =>
      sameName(labels.get(row.id) ?? "", said) ||
      (tool
        ? sameName(row.toolName, tool) && sameName(row.planName, leaf)
        : sameName(row.toolName, said) ||
          sameName(`${row.toolName} ${row.planName}`, said)),
  );
  const live = exact.filter(running);
  return live.length ? live : exact;
}

/**
 * The running plans a name might have meant, when none is called exactly
 * that: the ones sharing the most whole words with it. "The Claude
 * subscription" is probably Claude; and a word every plan shares — a
 * company's name on all its tools — does not make them all likely. Offered
 * in the question, never taken as the answer.
 */
export function plansLike<T extends PlanOnFile>(rows: T[], said: string): T[] {
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3);
  const heard = new Set(words(said));

  const scored = rows.filter(running).map((row) => ({
    row,
    shared: new Set(
      [...words(row.toolName), ...words(row.planName)].filter((word) =>
        heard.has(word),
      ),
    ).size,
  }));
  const best = Math.max(0, ...scored.map((one) => one.shared));
  return best
    ? scored.filter((one) => one.shared === best).map((one) => one.row)
    : [];
}

/* -------------------------------------------------------------------------- */
/*  The check                                                                  */
/* -------------------------------------------------------------------------- */

export function checkDraft(
  target: AiTarget,
  tidy: Record<string, string>,
  matches: NameMatches,
  /** The accounts that exist, to offer when a name matched none of them. */
  accountNames: string[],
  /** The plans on file: a new plan is held against them, a renewal offered them. */
  plans: PlanOnFile[] = [],
  /** Who on Team each name in a plan's `userNames` could be. */
  people: PeopleMatches = {},
): CheckedDraft {
  const schema = TARGET_SCHEMAS[target];
  const fields = nameFieldsFor(target);
  const draft: Record<string, string> = { ...tidy };
  const problems = new Map<string, string>();
  /** The problems that are a choice between real names, asked on their own. */
  const choices = new Set<string>();
  /** The people a plan's `userNames` were found to be, in the order said. */
  const onPlan: NameMatch[] = [];
  const notes: string[] = [];
  const found: Partial<Record<NameField["name"], NameMatch>> = {};
  /** A transfer still short of an account: its description is not asked for. */
  let describedLater = false;

  // Set by the app itself, or an id only the books can supply.
  for (const key of Object.keys(draft)) {
    if (!forTheModel(target, key)) delete draft[key];
  }
  // A name this record has no place for — a category on a transfer.
  for (const field of NAME_FIELDS) {
    if (!fields.includes(field)) delete draft[field.name];
  }
  // One of a fixed list, written the form's way rather than the list's:
  // "AI Tool" is `ai_tool`, "Monthly" is `monthly`.
  for (const [key, value] of Object.entries(draft)) {
    const choice = choicesOf(schema.shape[key])?.find(
      (entry) => plain(entry) === plain(value),
    );
    if (choice) draft[key] = choice;
  }

  for (const field of fields) {
    const said = draft[field.name];
    if (!said) continue;
    const candidates = matches[field.name] ?? [];

    if (candidates.length === 1) {
      found[field.name] = candidates[0];
      // As the books spell it, so the card and the Save agree on which.
      draft[field.name] = candidates[0].name;
      continue;
    }

    delete draft[field.name];
    // Several real names, or a plan that is not on file: which record this
    // is hangs on the answer — a renewal of one on file, or a new plan — so
    // nothing else is worth asking until it is given.
    if (candidates.length || field.kind === "plan") choices.add(field.name);
    problems.set(
      field.name,
      candidates.length
        ? `"${said}" could be ${listed(candidates.map((c) => c.name))}. Which one?`
        : field.kind === "account"
          ? `There is no account called "${said}". ${askFor(field.name, target)}${offer(accountNames)}`
          : field.kind === "plan"
            ? noSuchPlan(said, plans)
            : `There is no ${categoryKind(target)}category called "${said}". ${askFor(field.name, target)}`,
    );
  }

  /** A figure that is there, and is nothing: the endpoints refuse a zero. */
  const moreThanZero = (field: string, what: string) => {
    const value = draft[field];
    if (value === undefined || problems.has(field)) return;
    const figure = Number(value);
    if (!Number.isFinite(figure) || figure > 0) return;
    delete draft[field];
    problems.set(
      field,
      `${labelOf(field)} "${value}" cannot be saved: ${what} has to be more than zero. ${askFor(field, target)}`,
    );
  };

  if (target === "subscription") {
    /*
     * The Add subscription form's own rules, which its schema leaves open.
     * An active plan takes its first payment out of an account when it is
     * saved, so the form will not save one without the account; and that
     * payment is refused with no rate to read the dollars at. A taka price
     * beside the dollar one is a rate, said another way.
     */
    if (!draft.accountName && !problems.has("accountName")) {
      problems.set("accountName", askFor("accountName", target));
    }
    // A plan priced at nothing saves, and its first payment is then refused.
    moreThanZero("costUsd", "a plan's price");
    moreThanZero("usdRate", "the rate");
    if (!draft.usdRate && !draft.costBdt && !problems.has("usdRate")) {
      problems.set("usdRate", askFor("usdRate", target));
    }

    /*
     * A tool that is on file already. "Claude subscription kinlam" is far
     * more often this month's renewal of the Claude plan than a second one —
     * and a second plan added for a renewal is the plan charged twice on the
     * page. So it is said, not decided: with no plan named yet it is the
     * question; with one named, the draft stays and the line above it says
     * what is on file, whether the name is the same or another. Two plans of
     * one tool are a real thing (a seat each for two people), so this never
     * refuses.
     */
    const sameTool = plans.filter(
      (plan) =>
        running(plan) &&
        draft.toolName &&
        sameName(plan.toolName, draft.toolName),
    );
    if (sameTool.length) {
      const labels = planLabels(plans);
      const onFile = listed(
        sameTool.map((plan) => `${plan.toolName}${UNDER}${plan.planName}`),
      );
      const twin = sameTool.find(
        (plan) => draft.planName && sameName(plan.planName, draft.planName),
      );
      if (!draft.planName) {
        choices.add("planName");
        problems.set(
          "planName",
          `${draft.toolName} is on file already: ${onFile}. Is this a renewal, or a new plan? If it is new, which plan is it?`,
        );
      } else if (twin) {
        notes.push(
          `${labels.get(twin.id) ?? twin.toolName} is already on file. If this is its renewal, say so and I will draft that instead of a second plan.`,
        );
      } else {
        notes.push(
          `${sameTool[0].toolName} is on file already: ${onFile}. If this is its renewal, say so. If that plan was changed to this one, that is an Upgrade, on the plan's row. Otherwise this is added as a second plan.`,
        );
      }
    }
  }

  /*
   * Who is on a plan, by name (4 Oct 2026): each found on Team, as an
   * account's name is found among the accounts. One name two people share is
   * a choice, asked on its own; a name nobody has is asked again. The ones
   * found stay on the card, as Team spells them.
   */
  if (target === "subscription" && draft.userNames) {
    const unclear: string[] = [];
    const nobody: string[] = [];
    for (const said of namesListed(draft.userNames)) {
      const candidates = people[said.toLowerCase()] ?? [];
      if (candidates.length === 1) {
        if (!onPlan.some((person) => person.id === candidates[0].id)) {
          onPlan.push(candidates[0]);
        }
      } else if (candidates.length) {
        unclear.push(
          `"${said}" could be ${listed(candidates.map((c) => c.name))}.`,
        );
      } else {
        nobody.push(said);
      }
    }
    if (onPlan.length) {
      draft.userNames = onPlan.map((person) => person.name).join(", ");
    } else {
      delete draft.userNames;
    }
    if (unclear.length) {
      choices.add("userNames");
      problems.set("userNames", `${unclear.join(" ")} Which one?`);
    } else if (nobody.length) {
      problems.set(
        "userNames",
        `There is nobody on Team called ${listed(nobody.map((name) => `"${name}"`))}. Who did you mean? Or say skip.`,
      );
    }
  }

  if (target === "subscription_payment") {
    const plan = found.subscriptionName?.plan;

    // The endpoint refuses a rate or an amount of nothing; and dollars of
    // nothing are passed over there, the plan's own price charged instead.
    moreThanZero("usdRate", "the rate");
    moreThanZero("usdAmount", "what the card was billed");
    moreThanZero("amount", "the amount");

    /*
     * What the Renew drawer offers before anybody types: the plan's own
     * price, and the account the plan is paid from. From the books, on the
     * card, for the person to check — not a figure anybody made up.
     *
     * The dollars go on the card even when the taka was given. The endpoint
     * writes the plan's own price as the entry's dollars whenever none are
     * stated, and a dollar account's balance moves by exactly them — so they
     * are shown, where they can be corrected, rather than written unseen.
     */
    if (plan) {
      if (
        !draft.usdAmount &&
        !problems.has("usdAmount") &&
        plan.payableUsd &&
        Number(plan.payableUsd) > 0
      ) {
        draft.usdAmount = plan.payableUsd;
      }
      if (!draft.accountName && !problems.has("accountName") && plan.account) {
        draft.accountName = plan.account.name;
        found.accountName = plan.account;
      }
    }

    // With neither, the endpoint refuses: it has no figure to charge, or no
    // account to charge it to.
    if (found.subscriptionName) {
      if (!draft.usdAmount && !draft.amount && !problems.has("usdAmount")) {
        problems.set(
          "usdAmount",
          `The plan has no price on it. ${askFor("usdAmount", target)}`,
        );
      }
      if (!draft.accountName && !problems.has("accountName")) {
        problems.set(
          "accountName",
          `The plan has no card or account on it. ${askFor("accountName", target)}`,
        );
      }
    }

    /*
     * The rate is asked every time, with the plan's own offered and never
     * taken: the owner's reason for the box on the drawer was "prottek
     * renewal a rate soman thakena".
     */
    if (!draft.usdRate && !problems.has("usdRate")) {
      problems.set(
        "usdRate",
        plan?.usdRate && Number(plan.usdRate) > 0
          ? `${askFor("usdRate", target)} The plan's own is ${Number(plan.usdRate)}.`
          : askFor("usdRate", target),
      );
    }
  }

  /*
   * A rate with nothing it converted. The schema's refusal names `fxRate`,
   * which is the half that IS there — asking for it again would take any
   * answer off the draft and ask a third time. What is missing is the amount.
   */
  const settled = new Set<string>();
  if (
    draft.fxRate &&
    !draft.originalAmount &&
    "originalAmount" in schema.shape
  ) {
    settled.add("fxRate");
    problems.set(
      "originalAmount",
      `A rate of ${draft.fxRate} was given with no foreign amount for it to convert. ${askFor("originalAmount", target)}`,
    );
  }

  if (target === "transfer") {
    const from = found.fromAccountName;
    const to = found.toAccountName;

    if (from && to && from.id === to.id) {
      delete found.toAccountName;
      delete draft.toAccountName;
      problems.set(
        "toAccountName",
        `Both sides are ${from.name}. Which of our accounts does the money go to?`,
      );
    }

    /*
     * The Money Transfer form's own rule: with a dollar account on either
     * side it asks for the dollars that moved, because that account's balance
     * is kept in them. The schema leaves `usdAmount` optional, so this is the
     * one requirement taken from the form rather than from the schema.
     */
    const dollar = [from, found.toAccountName].find(
      (account) => account?.currency === "USD",
    );
    if (dollar && !draft.usdAmount) {
      problems.set(
        "usdAmount",
        `${dollar.name} is a dollar account. How many dollars moved?`,
      );
    }
    // And the other half of that rule: between two taka accounts the form
    // sends no dollars, so none are kept — the pair would be stored as USD.
    if (from && found.toAccountName && !dollar) delete draft.usdAmount;

    // Nothing was bought, so there is nothing to ask what it was for: the
    // description is the two accounts, once both are known.
    if (!draft.description) {
      if (from && found.toAccountName) {
        draft.description = `Transfer from ${from.name} to ${found.toAccountName.name}`;
      } else {
        describedLater = true;
      }
    }
  }

  // What Save will post: ids for names, and the two keys the app adds itself.
  const body = (): Record<string, unknown> => {
    const sent: Record<string, unknown> = { ...draft };
    for (const field of NAME_FIELDS) delete sent[field.name];
    // The people on a plan, by their ids on Team.
    if (target === "subscription") {
      delete sent.userNames;
      if (onPlan.length) {
        sent.users = onPlan.map((person) => ({ teamMemberId: person.id }));
      }
    }
    for (const field of fields) {
      const match = found[field.name];
      if (match) sent[field.id] = match.id;
    }
    if (target === "transaction_in" || target === "transaction_out") {
      sent.direction = target === "transaction_in" ? "in" : "out";
      sent.createdVia = "ai_intake";
    }
    // As the Renew drawer sends it, unless somebody unticks the box.
    if (target === "subscription_payment") sent.advanceRenewal = true;
    return sent;
  };

  let parsed = schema.safeParse(body());

  /*
   * A key the endpoint does not know is refused whole — "Unrecognized key".
   * It is taken off the draft rather than asked about: there is no answer
   * that would make `vendorName` saveable on a payment.
   */
  const unknown = parsed.success ? [] : unrecognised(parsed.error.issues);
  if (unknown.length) {
    for (const key of unknown) delete draft[nameOf(key)];
    parsed = schema.safeParse(body());
  }

  if (!parsed.success) {
    /*
     * A rule between two fields is judged only once each field is sound on
     * its own. With "4500,50" as the amount, "the bill must cover the amount"
     * compares against no number at all, and would take a good bill off the
     * draft for the amount's fault.
     */
    const issues = parsed.error.issues;
    const own = issues.filter((issue) => issue.code !== "custom");

    for (const issue of own.length ? own : issues) {
      const key = issue.path[0];
      if (typeof key === "string" && settled.has(key)) continue;
      if (typeof key !== "string") {
        // A refusal of the entry as a whole. No create schema has one today;
        // if one gains it, the draft must still not read as ready.
        if (!problems.has("entry")) {
          problems.set("entry", sentence(issue.message));
        }
        continue;
      }
      const field = nameOf(key);
      if (problems.has(field)) continue;

      const value = draft[field];
      if (value === undefined) {
        // A rule between two fields says why in its own words; a plain
        // absence only says "expected string, received undefined".
        problems.set(
          field,
          issue.code === "custom"
            ? `${sentence(issue.message)} ${askFor(field, target)}`
            : askFor(field, target),
        );
        continue;
      }

      // Given, and not something the endpoint will take. Asked again rather
      // than left on a card whose Save cannot work.
      delete draft[field];
      problems.set(
        field,
        `${labelOf(field)} "${value}" cannot be saved: ${sentence(issue.message)} What should it be?`,
      );
    }
  }

  if (describedLater) problems.delete("description");

  return {
    draft,
    problems: [...problems.entries()]
      .map(([field, question]) =>
        choices.has(field)
          ? { field, question, choice: true }
          : { field, question },
      )
      .sort((a, b) => askOrder(a.field) - askOrder(b.field)),
    notes,
    body: body(),
  };
}

function unrecognised(issues: z.core.$ZodIssue[]): string[] {
  return issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
}

type ChoiceDef = {
  type?: string;
  innerType?: z.ZodType;
  entries?: Record<string, string>;
};

/** The allowed values, for a field that takes one of a fixed list. */
function choicesOf(field: unknown): string[] | null {
  let current = field as { def?: ChoiceDef } | undefined;
  for (let depth = 0; depth < 6 && current?.def; depth += 1) {
    if (current.def.type === "enum" && current.def.entries) {
      return Object.keys(current.def.entries);
    }
    current = current.def.innerType;
  }
  return null;
}

/** A value with its dress off: "AI Tool", "ai-tool" and "ai_tool" are one. */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The draft's key for a schema's: `categoryId` is asked as `categoryName`. */
export function nameOf(key: string): string {
  return NAME_FIELDS.find((field) => field.id === key)?.name ?? key;
}

/** Whether this kind of record has such a field at all. */
export function knowsField(target: AiTarget, field: string): boolean {
  return (
    field in TARGET_SCHEMAS[target].shape ||
    nameFieldsFor(target).some((known) => known.name === field) ||
    isStandIn(target, field)
  );
}

/** "Rasel, Nizam and Tania": each name once, in the order said. */
export function namesListed(text: string): string[] {
  const names = text
    .split(/\s*(?:,|;|\n|\band\b|&|\bar\b|\bo\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/* -------------------------------------------------------------------------- */
/*  The questions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What is asked first when several things are missing: where the money is,
 * how much, then the rest. One question a turn, so the order is the
 * conversation.
 */
const ASK_FIRST = [
  "subscriptionName",
  "toolName",
  "planName",
  "fromAccountName",
  "toAccountName",
  "accountName",
  "amount",
  "costUsd",
  "usdAmount",
  "category",
  "categoryName",
  "txnDate",
  "startDate",
  "description",
  "usdRate",
];

function askOrder(field: string): number {
  const at = ASK_FIRST.indexOf(field);
  return at === -1 ? ASK_FIRST.length : at;
}

/**
 * The question for a field nobody has answered.
 *
 * Every field a schema requires has one here — draft-check.spec.ts holds that
 * to be true, so a field made required later cannot arrive at a person as
 * "What is the joined on?".
 */
const QUESTIONS: Record<string, string> = {
  fromAccountName: "Which of our accounts does the money leave?",
  toAccountName: "Which of our accounts does the money go to?",
  categoryName: "Which category is this under?",
  amount: "How much was it, in taka?",
  usdAmount: "How many dollars moved?",
  txnDate: "What date was it?",
  description: "What was it for?",
  usdRate:
    "What was the USD rate that day? Every entry that moves money carries one.",
  fxRate: "What rate did the bank convert it at?",
  originalAmount: "How much was sent, in the foreign currency?",
  billAmount: "What was the gross bill, before tax was withheld?",
  fullName: "What is their full name?",
  joinedOn: "When did they join?",
  name: "What is the vendor called?",
  challanNumber: "What is the challan number?",
  challanDate: "What date is on the challan?",
  depositDate: "When was it deposited?",
  periodYear: "Which year is the challan for?",
  periodMonth: "Which month is the challan for?",
  subscriptionName: "Which plan is being renewed?",
  toolName: "Which tool or service is it?",
  planName: "Which plan of it was bought?",
  category:
    "What kind of tool is it: AI tool, development, marketing, design, HR, productivity, management, eSIM, server support or finance?",
  costUsd: "What is the plan's price, in dollars?",
  costBdt: "What is the price in taka?",
  startDate: "What date was it bought?",
};

const ACCOUNT_QUESTION: Partial<Record<AiTarget, string>> = {
  transaction_out: "Which account was it paid from?",
  transaction_in: "Which account did it come into?",
  tds_deposit: "Which account was it paid from?",
  subscription:
    "Which card or account is it paid from? The price comes out of it when the plan is saved.",
  subscription_payment: "Which card or account was it paid from?",
};

/** Where one kind of record asks for a field in words of its own. */
const QUESTIONS_ON: Partial<Record<AiTarget, Record<string, string>>> = {
  subscription: {
    usdRate:
      "What USD rate is the price read at? The first payment is recorded in taka at it.",
  },
  subscription_payment: {
    txnDate: "What date was the card charged?",
    usdAmount: "How many dollars was the card billed?",
    usdRate: "What rate was this renewal charged at?",
  },
};

export function askFor(field: string, target: AiTarget): string {
  if (field === "accountName") {
    return ACCOUNT_QUESTION[target] ?? "Which account is it?";
  }
  return (
    QUESTIONS_ON[target]?.[field] ??
    QUESTIONS[field] ??
    `What is the ${labelOf(field).toLowerCase()}?`
  );
}

/** "money-out " before "category", where the record goes one way. */
function categoryKind(target: AiTarget): string {
  if (target === "transaction_out") return "money-out ";
  if (target === "transaction_in") return "money-in ";
  return "";
}

/** True when a required field has a question written for it. */
export function hasOwnQuestion(field: string): boolean {
  return field === "accountName" || field in QUESTIONS;
}

const LABELS: Record<string, string> = {
  txnDate: "Date",
  usdRate: "USD rate",
  fxRate: "Rate",
  usdAmount: "Amount in dollars",
  accountName: "Account",
  fromAccountName: "From account",
  toAccountName: "To account",
  categoryName: "Category",
  paymentMethod: "Payment method",
  withheldTaxAmount: "Tax withheld",
  billAmount: "Gross bill",
  chargeAmount: "Bank charge",
  chargeUsd: "Bank charge in dollars",
  etin: "e-TIN",
  bin: "BIN",
  subscriptionName: "Plan",
  toolName: "Tool",
  planName: "Plan",
  costUsd: "Price in dollars",
  costBdt: "Price in taka",
  startDate: "Start date",
  // As the plan's row heads them.
  userNames: "User Name",
  loginEmail: "Login accounts",
  boughtFor: "User Department",
  invoiceNo: "Invoice no.",
  reference: "Reference",
};

/** A field as the page heads it: "USD rate", "Login accounts". */
export function fieldLabel(field: string): string {
  return labelOf(field);
}

function labelOf(field: string): string {
  const named = LABELS[field];
  if (named) return named;
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "A, B or C". */
function listed(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The accounts to choose from, when there are few enough to say. */
function offer(accountNames: string[]): string {
  if (!accountNames.length || accountNames.length > 12) return "";
  return ` The accounts are ${listed(accountNames)}.`;
}

/** The running plans to choose from, when there are few enough to say. */
function offerPlans(plans: PlanOnFile[]): string {
  const labels = planLabels(plans);
  const names = plans
    .filter(running)
    .map((plan) => labels.get(plan.id) ?? plan.toolName);
  if (!names.length || names.length > 12) return "";
  return ` On file: ${listed(names)}.`;
}

/**
 * What is asked when a renewal names no plan on file: the ones it might
 * have meant, if any share a word with it; otherwise the ones there are.
 * A near match is offered here and never taken — a renewal is money against
 * a plan, and "Claude Code" is not the plan called Claude until somebody
 * says so.
 */
function noSuchPlan(said: string, plans: PlanOnFile[]): string {
  const labels = planLabels(plans);
  const close = plansLike(plans, said).map(
    (plan) => labels.get(plan.id) ?? plan.toolName,
  );
  const opening = `There is no plan called "${said}" under AI tools and subscriptions.`;
  return close.length && close.length <= 6
    ? `${opening} Did you mean ${listed(close)}? If it is a new plan, say so.`
    : `${opening} Is it a new plan, or which one on file is it?${offerPlans(plans)}`;
}

/** A schema's message, ended as a sentence. */
function sentence(message: string): string {
  const text = message.trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/* -------------------------------------------------------------------------- */
/*  What the model may not say                                                 */
/* -------------------------------------------------------------------------- */

/*
 * "Recorded", in the three ways people here write.
 *
 * The assistant writes nothing to the books — a person presses Save — so "I
 * have recorded it" is false whenever it is said. The prompt forbids it; this
 * is for the model that says it anyway, as Gemini did ("transfer record
 * korechi") about a draft that could not even be saved.
 */
const DID = "record|save|transfer|entry|post|book";

/**
 * Bangla, with য় in one spelling. It can be typed as one character or as two
 * (য and a dot below), and a pattern written one way misses text written the
 * other. NFC settles both on the same form; the text is put through it too.
 */
const bangla = (source: string) => new RegExp(source.normalize("NFC"));

/** Said in the first person: untrue wherever it appears. */
const I_DID_IT = [
  /\bI(?:['’]ve| have)?\s+(?:(?:now|just|already|successfully)\s+)*(?:recorded|saved|transferred|posted|booked)\b/i,
  // "Recorded." and "Saved the transfer." — the same claim with the "I" left off.
  /(?:^|[.!?]\s+)(?:recorded|saved|transferred)(?:\s+(?:it|this|that|the|your)\b|\s*[.!]|\s*$)/i,
  new RegExp(
    `\\b(?:${DID}|add)\\w*\\s+(?:ta\\s+|ti\\s+)?(?:kor(?:e)?(?:ch+i|si)|korlam|kore\\s*(?:diyech+i|diyesi|disi|dilam|felech+i|felsi|rekhech+i|rakhlam))\\b`,
    "i",
  ),
  bangla(
    "(?:রেকর্ড|সেভ|ট্রান্সফার|এন্ট্রি|যোগ|পোস্ট)\\s*(?:টি|টা)?\\s*(?:করেছি|করলাম|করে\\s*(?:দিয়েছি|দিলাম|ফেলেছি|রেখেছি))",
  ),
];

/** Said of the thing itself: untrue while a draft is still on the table. */
const IT_IS_DONE = [
  /\b(?:has|have)\s+been\s+(?:(?:now|just|already|successfully)\s+)*(?:recorded|saved|transferred|added|posted|entered|booked|completed)\b/i,
  /\b(?:is|are|was|were)\s+(?:(?:now|already|successfully)\s+)*(?:recorded|saved|transferred|posted|booked|done|completed?)\b/i,
  /\bsuccessfully\b/i,
  /\bdone\b[.!]*\s*$/i,
  new RegExp(
    `\\b(?:${DID}|add)\\w*\\s+(?:ta\\s+|ti\\s+)?(?:kora\\s+)?(?:hoye?\\s*(?:ge(?:ch+e|se|lo)|ech+e)|hoyech+e|hoise|hoich+e|done|complete|shesh)\\b`,
    "i",
  ),
  bangla(
    "(?:রেকর্ড|সেভ|ট্রান্সফার|এন্ট্রি|যোগ|পোস্ট)\\s*(?:টি|টা)?\\s*(?:করা\\s*)?(?:হয়েছে|হয়ে\\s*গেছে|সম্পন্ন)",
  ),
];

/**
 * Whether a sentence says the thing has been recorded.
 *
 * `draftOpen` is for a turn in a conversation that has a draft on the table:
 * there "it has been saved" is untrue too. Without one, only the first person
 * is held to — "three transfers were recorded in August" is an answer about
 * the books, and a true one. A batch and an import plan are held to the first
 * person only as well: "3 of these are already recorded, so I left them out"
 * is exactly what the model is asked to report beside them.
 */
export function claimsItIsDone(text: string, draftOpen: boolean): boolean {
  const said = text.normalize("NFC");
  const patterns = draftOpen ? [...I_DID_IT, ...IT_IS_DONE] : I_DID_IT;
  return patterns.some((pattern) => pattern.test(said));
}
