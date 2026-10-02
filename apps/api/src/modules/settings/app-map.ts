import { appPart } from "../../common/app-map";

/**
 * Settings is one screen with a section for each of several modules. None
 * of it is the Assistant's to change: the brief (2 Oct 2026) keeps settings,
 * and anything about the people who can sign in, out of its reach.
 */
export const SETTINGS_MAP = [
  appPart({
    key: "settings",
    name: "Settings",
    modules: [
      "settings",
      "categories",
      "users",
      "trash",
      "audit",
      "fx",
      "email",
      "notifications",
      "connections",
    ],
    purpose:
      "How the app itself is set up: the company's details and number formats, its colours and type, the expense headings and their sub-categories, the salary tax policy, each person's own sign-in, the people who can sign in and their roles, the log of what changed, what was trashed, the Assistant, the Google Cloud connection, email and notifications, and locking a period's books.",
    keeps: [
      "A category: an expense or income heading, and the sub-categories under it. A payment is filed against a sub-category.",
      "Who can sign in, and as which role.",
      "What was deleted: it is in Trashed, and can be put back from there.",
      "What changed, when and by whom: the audit log. It cannot be edited.",
    ],
    screens: [
      {
        href: "/settings",
        name: "Settings",
        does: "Sections: Company & formatting, Appearance, Categories, Salary TDS, Your sign-in, People who can sign in, What changed, Trashed, Assistant, Connections, Email, Notifications.",
      },
    ],
    recordedBy: ["PATCH /settings", "POST /categories", "POST /users"],
    permission: "settings.read",
    assistant: {
      drafts: [],
      reads: [],
      otherwise:
        "I cannot change anything under Settings: not a category, not a role or a person who can sign in, not the tax policy, not a locked period, and I cannot restore or delete what is in Trashed. Each is done in its own section of Settings.",
    },
  }),
];
