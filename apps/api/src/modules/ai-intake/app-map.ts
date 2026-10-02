import { AI_TARGET_LABELS, type AiTarget } from "@finance/shared";

import type { AppForm, AppPart } from "../../common/app-map";
import { ACCOUNTS_MAP } from "../accounts/app-map";
import { BANK_ADVICES_MAP } from "../bank-advices/app-map";
import { BANK_STATEMENT_MAP } from "../bank-statements/app-map";
import { DASHBOARD_MAP } from "../dashboard/app-map";
import { EXPENSES_MAP } from "../expenses/app-map";
import { HR_BUDGET_MAP } from "../hr-budget/app-map";
import { HR_REQUESTS_MAP } from "../hr-requests/app-map";
import { DATA_MAP } from "../imports/app-map";
import { INCOME_TAX_MAP } from "../income-tax/app-map";
import { INVOICES_MAP } from "../invoices/app-map";
import { PAYROLL_MAP } from "../payroll/app-map";
import { REPORTS_MAP } from "../reports/app-map";
import { SETTINGS_MAP } from "../settings/app-map";
import { SUBSCRIPTIONS_MAP } from "../subscriptions/app-map";
import { TDS_MAP } from "../tds/app-map";
import { TEAM_MAP } from "../team-members/app-map";
import { TRANSACTIONS_MAP } from "../transactions/app-map";
import { VENDORS_MAP } from "../vendors/app-map";
import { ASSISTANT_MAP } from "./assistant.app-map";
import { formFields } from "./field-reference";

/**
 * The whole map, in the order the rail has the screens: money first, then
 * people, tax, insight, and the app's own settings.
 *
 * Each part is written beside its own module (`<module>/app-map.ts`); what
 * the type means is in `common/app-map.ts`. `app-map.spec.ts` holds the map
 * to the app: every module has an entry, every screen and endpoint named
 * here exists, and every kind of draft and every look-up tool belongs to a
 * part.
 */
export const APP_MAP: readonly AppPart[] = [
  ...DASHBOARD_MAP,
  ...ACCOUNTS_MAP,
  ...TRANSACTIONS_MAP,
  ...EXPENSES_MAP,
  ...SUBSCRIPTIONS_MAP,
  ...VENDORS_MAP,
  ...TEAM_MAP,
  ...PAYROLL_MAP,
  ...BANK_ADVICES_MAP,
  ...HR_REQUESTS_MAP,
  ...HR_BUDGET_MAP,
  ...TDS_MAP,
  ...INCOME_TAX_MAP,
  ...REPORTS_MAP,
  ...BANK_STATEMENT_MAP,
  ...INVOICES_MAP,
  ...DATA_MAP,
  ...SETTINGS_MAP,
  ...ASSISTANT_MAP,
];

/**
 * Module folders that are no part of the app a person uses: the plumbing
 * under every part. Named here with the reason, so that a new folder is
 * either given an entry in the map or put on this list on purpose.
 */
export const NOT_A_PART: Record<string, string> = {
  auth: "Signing in and out. Every part sits behind it.",
  health: "Answers whether the API is up. No screen, no records.",
  files:
    "Stores the papers attached to other parts' records. Each is opened from its own record.",
  "hr-webhook":
    "Tells the HR portal about decisions made under HR Requests. Nothing a person opens.",
};

/**
 * Pages of the web app that are no screen of a part, with the reason. A new
 * page is either put on a part's `screens` or here, on purpose.
 */
export const NOT_A_SCREEN: Record<string, string> = {
  "/hr-budget":
    "An old address. It opens HR Requests on its budgets or its spends.",
  "/import": "An old address. It opens Import and Export (/data).",
  "/invoice-builder":
    "An old address. It opens the invoice builder (/invoices/new).",
  "/no-access":
    "Shown in place of a page somebody's role cannot open, naming what it needs.",
};

/**
 * Requests that change something and that no form on a screen of this app
 * sends: a step inside another form's Save, something the HR portal sends
 * under its own sign-in, or an endpoint a retired screen left behind. Named
 * with the reason, so that a new endpoint is either given a form on the map
 * or put here on purpose — and so the Assistant is never told a screen
 * exists for one of these.
 */
export const NOT_A_FORM: Record<string, string> = {
  "DELETE /ai/chats":
    "Deletes every conversation of the person asking. No screen offers it; the history list deletes one at a time.",

  // Sent by the HR portal, under its own sign-in. What it sends then waits
  // on HR Requests, where finance decides it.
  "POST /hr-requests/pay-changes":
    "Sent by the HR portal under its own sign-in: a pay change it asks for, which then waits on HR Requests. No screen here sends it.",
  "POST /hr-requests/pay-changes/:externalId/withdraw":
    "Sent by the HR portal when HR takes back a pay change still waiting. No screen here sends it.",
  "POST /hr-requests/one-offs/:externalId/withdraw":
    "Sent by the HR portal when HR takes back a one-off still waiting. No screen here sends it.",
  "POST /hr-requests/budgets/:externalId/withdraw":
    "Sent by the HR portal when HR takes back a budget still waiting. No screen here sends it.",
  "POST /hr-requests/spends/:externalId/withdraw":
    "Sent by the HR portal when HR takes back a spend still waiting. No screen here sends it.",
  "POST /payroll/one-offs":
    "Sent by the HR portal: a one-off for a month's salary sheet, which waits on HR Requests until finance decides it. No screen here sends it.",
  "POST /hr-budget/periods":
    "Sent by the HR portal: a budget it asks for, which then waits on HR Requests. No screen here sends it.",
  "POST /hr-budget/spends":
    "Sent by the HR portal: a spend against a budget, which then waits on HR Requests. No screen here sends it.",

  // Left behind by screens that were retired. The endpoints still answer;
  // nothing a person opens sends them.
  "POST /hr-budget/periods/:id/decision":
    "The old HR Budget page's decision. A budget is decided on HR Requests now, through POST /hr-requests/:kind/:id/decision.",
  "POST /hr-budget/spends/:id/decision":
    "The old HR Budget page's decision. A spend is decided on HR Requests now, through POST /hr-requests/:kind/:id/decision.",
  "PATCH /tds/deposits/:id":
    "Corrects a recorded challan. No screen sends it since the challans panel left the TDS screen.",
  "POST /tds/deposits/:id/allocations":
    "Ties a challan to the salary rows and payments it settled. No screen sends it since the challans panel left the TDS screen.",
  "POST /tds/returns/:id/file":
    "Marks a quarterly withholding return filed. No screen sends it since the returns left the TDS screen.",
  "POST /income-tax/schedule":
    "Sets up an income year's advance-tax instalments. No screen sends it since the income tax screen was retired.",
  "PATCH /income-tax/:id":
    "Corrects an instalment. No screen sends it since the income tax screen was retired.",
  "POST /income-tax/:id/pay":
    "Records an instalment paid, with its ledger entry. No screen sends it since the income tax screen was retired.",
  "POST /fx/rates":
    "Sets a stored exchange rate. No screen sends it since the Exchange rate section left Settings; every entry states its own rate.",
  "DELETE /fx/rates/:id":
    "Deletes a stored exchange rate. No screen sends it since the Exchange rate section left Settings.",
  "PATCH /vendors/:id":
    "Edits a vendor. Nothing sends it: no screen edits a vendor, and the Assistant drafts only new ones.",
  "DELETE /subscriptions/:id":
    "Nothing sends it: Move to trash on a plan's row goes through the trash, and a finished plan is cancelled in Edit.",
  "DELETE /email/key":
    "Removes the Resend key. Settings, Email has no button for it; saving a new key replaces the old one.",
};

export const APP_PART_KEYS = APP_MAP.map((part) => part.key);

/** Every form on the map, with the part it is in. */
export function allForms(): Array<{ part: AppPart; form: AppForm }> {
  return APP_MAP.flatMap((part) => part.forms.map((form) => ({ part, form })));
}

/**
 * A form's fields, as the map shows them: generated from the schema its
 * Save is checked with, each with what it means where the map says it.
 * Without a schema, the fields the map names by hand.
 */
export function fieldsOf(
  form: AppForm,
): Array<{ name: string; required: boolean | null; means: string | null }> {
  if (form.schema) {
    return formFields(form.schema).map((field) => ({
      name: field.name,
      required: field.required,
      means: form.fields?.[field.name] ?? null,
    }));
  }
  return Object.entries(form.fields ?? {}).map(([name, means]) => ({
    name,
    // Nothing to read it from: the map does not guess.
    required: null,
    means,
  }));
}

/**
 * One form, as a line of the prompt.
 *
 * Shorter than the page's: the fields Save needs and the ones the map
 * explains, then how many others there are. A form the Assistant drafts
 * points to its own list under EVERY FIELD, which says the same at length;
 * written twice, the money forms alone were half the map. "What the
 * Assistant knows" shows every field.
 */
function renderForm(form: AppForm): string {
  const screen = APP_MAP.flatMap((part) => part.screens).find(
    (one) => one.href === form.on,
  );
  const fields = fieldsOf(form);
  const told = fields.filter((field) => field.required || field.means);
  const rest = fields.length - told.length;
  const listed = form.draft
    ? ` Fields: those of ${form.draft} under EVERY FIELD.`
    : fields.length
      ? ` Fields: ${told
          .map(
            (field) =>
              `${field.name}${field.required ? "*" : ""}${field.means ? ` (${field.means})` : ""}`,
          )
          .join(", ")}${
          rest ? `${told.length ? ", and " : ""}${rest} more optional` : ""
        }.`
      : "";
  return `  - "${form.name}" — ${form.opens}${screen ? `, on ${screen.name}` : ""}.${listed} Save: ${form.onSave}${
    form.draft ? ` You draft this one as ${form.draft}.` : ""
  }`;
}

export function partOf(key: string | null | undefined): AppPart | null {
  return APP_MAP.find((part) => part.key === key) ?? null;
}

/**
 * The parts a kind of draft belongs to. A money-in entry is both the
 * ledger's and Cash In's; most kinds have one home.
 */
export function partsDrafting(target: AiTarget): AppPart[] {
  return APP_MAP.filter((part) => part.assistant.drafts.includes(target));
}

/** The screen to send somebody to for a part: its first, if it has one. */
export function screenOf(
  part: AppPart | null,
): { name: string; href: string } | null {
  // A record's own page needs its id; the link is to the list it is on.
  const screen = part?.screens.find((one) => !one.href.includes("["));
  return screen ? { name: screen.name, href: screen.href } : null;
}

/**
 * The map, written out for the prompt.
 *
 * One block a part, in the same order every time: what it is for, what is
 * kept there, where, and what the Assistant may do there. Identical on every
 * turn of every conversation, so it sits in the cached half of the prompt.
 */
export function renderAppMap(): string {
  return APP_MAP.map((part) => {
    const lines = [
      `[${part.key}] ${part.name}`,
      `  For: ${part.purpose}`,
      ...part.keeps.map((kept) => `  Kept here: ${kept}`),
      part.screens.length
        ? `  Screens: ${part.screens
            .map((screen) => `${screen.name} (${screen.href}) — ${screen.does}`)
            .join(" | ")}`
        : "  Screens: none. No screen shows this today.",
      part.assistant.drafts.length
        ? `  You can draft here: ${part.assistant.drafts
            .map((target) => `${target} (${AI_TARGET_LABELS[target]})`)
            .join(", ")}`
        : "  You cannot draft anything here.",
      part.assistant.oneAtATime
        ? "  One at a time, in 'draft'. Never several of these in 'batch'."
        : null,
      part.assistant.reads.length
        ? `  You can look up, if the person's role may: ${part.assistant.reads.join(", ")}`
        : null,
      part.forms.length
        ? `  Its forms and buttons (* = Save needs it):\n${part.forms.map(renderForm).join("\n")}`
        : null,
      `  Anything else here, say: "${part.assistant.otherwise}"`,
    ];
    return lines.filter(Boolean).join("\n");
  }).join("\n\n");
}
