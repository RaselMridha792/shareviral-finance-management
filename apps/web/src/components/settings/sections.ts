import type { Permission } from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { BellRingingIcon } from "@phosphor-icons/react/dist/ssr/BellRinging";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key";
import { PaletteIcon } from "@phosphor-icons/react/dist/ssr/Palette";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { TagIcon } from "@phosphor-icons/react/dist/ssr/Tag";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { UserCircleGearIcon } from "@phosphor-icons/react/dist/ssr/UserCircleGear";

/**
 * Settings' sections, in the groups the September 2026 handoff gives them.
 *
 * One list for two readers: the Settings sidebar draws it as its nav, and the
 * screen draws the chosen one's header from it. The ids are the ones
 * `/settings?tab=` has always taken — the Assistant screen links to
 * `?tab=assistant` — so the handoff's own names for them were not adopted.
 *
 * A `permission` hides the section from the nav; the screen refuses to draw
 * the panel as well, and the API refuses the calls. Hidden here is
 * convenience, not the boundary.
 */
export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  icon: Icon;
  /** The one line under the label in the nav. */
  hint: string;
  /** The header's line under the title. */
  description: string;
  group: "General" | "Access" | "Data" | "Integrations";
  permission?: Permission;
};

export type SettingsSectionId =
  | "company"
  | "categories"
  | "tax"
  | "security"
  | "users"
  | "audit"
  | "trashed"
  | "assistant"
  | "email"
  | "notifications"
  | "appearance";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "company",
    label: "Company & formatting",
    icon: BuildingsIcon,
    hint: "Name, letterhead, year",
    description: "Company details, payslip letterhead and how figures read.",
    group: "General",
  },
  // The Super Admin's alone, as the API is: the look of the company's app
  // changes for everybody at once (#124).
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    hint: "Colours and type",
    description:
      "The colours and typefaces every screen is drawn in — for everybody.",
    group: "General",
    permission: "settings.write",
  },
  {
    id: "categories",
    label: "Categories",
    icon: TagIcon,
    hint: "Headings and sub-categories",
    description: "Two levels of headings every payment is filed under.",
    group: "General",
  },
  // Readable by anyone who can see the tax screens; only settings.write may
  // save. The calculator is the reason it is not settings-only — checking a
  // figure against the accountant's working is not an administrative act.
  {
    id: "tax",
    label: "Salary TDS",
    icon: PercentIcon,
    hint: "Slabs, rebate, minimum",
    description:
      "What the app deducts from salaries, one rule per income year.",
    group: "General",
    permission: "tds.read",
  },
  // No permission. This is your own account's second factor, not an
  // administrator's view of anybody else's.
  {
    id: "security",
    label: "Your sign-in",
    icon: KeyIcon,
    hint: "Card password, two-step",
    description: "Your own secrets: the card password and two-step sign-in.",
    group: "Access",
  },
  // Creating an account is the ability to grant any permission in the app, so
  // this is Super Admin only — and the API refuses everyone else anyway.
  {
    id: "users",
    label: "People who can sign in",
    icon: UserCircleGearIcon,
    hint: "Roles and accounts",
    description: "Who can sign in, and as what.",
    group: "Access",
    permission: "users.manage",
  },
  {
    id: "audit",
    label: "What changed",
    icon: ClockCounterClockwiseIcon,
    hint: "Every change, with who",
    description: "The audit trail — written with the change itself.",
    group: "Access",
    permission: "audit.read",
  },
  /*
   * Everything anybody deleted, waiting to be restored or purged. Gated the
   * way the screen itself is — reachable with settings.read — because the API
   * already narrows what it lists to the kinds this role could have deleted,
   * and a person who deleted a row on some other screen must be able to reach
   * the place it went without a permission they never needed to delete it.
   */
  {
    id: "trashed",
    label: "Trashed",
    icon: TrashIcon,
    hint: "Restore or empty",
    description:
      "Deleted rows wait here until somebody restores or empties them.",
    group: "Data",
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: RobotIcon,
    hint: "Anthropic API key",
    description: "The optional assistant that fills forms from a sentence.",
    group: "Integrations",
    permission: "settings.write",
  },
  {
    id: "email",
    label: "Email",
    icon: EnvelopeSimpleIcon,
    hint: "Resend and reminders",
    description: "Renewal reminders and the domain that sends them.",
    group: "Integrations",
    permission: "settings.write",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellRingingIcon,
    hint: "What rings the bell",
    description: "Which events raise a notification in the top bar.",
    group: "Integrations",
    permission: "settings.write",
  },
];

export const SETTINGS_GROUPS = [
  "General",
  "Access",
  "Data",
  "Integrations",
] as const;

/** The section `?tab=` names, if this reader may open it; else the first. */
export function settingsSectionFor(
  tab: string | null | undefined,
  allowed: (section: SettingsSection) => boolean,
): SettingsSection {
  const visible = SETTINGS_SECTIONS.filter(allowed);
  return visible.find((section) => section.id === tab) ?? visible[0];
}
