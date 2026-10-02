import { AI_TARGET_LABELS, type AiTarget } from "@finance/shared";

import type { AppPart } from "../../common/app-map";
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

export const APP_PART_KEYS = APP_MAP.map((part) => part.key);

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
      `  Anything else here, say: "${part.assistant.otherwise}"`,
    ];
    return lines.filter(Boolean).join("\n");
  }).join("\n\n");
}
