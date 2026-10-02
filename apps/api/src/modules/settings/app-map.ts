import {
  createCategorySchema,
  createUserSchema,
  lockBooksSchema,
  resetPasswordSchema,
  setGoogleKeySchema,
  themeSchema,
  typographySchema,
  updateCategorySchema,
  updateSettingsSchema,
  updateUserSchema,
} from "@finance/shared";

import { appPart } from "../../common/app-map";
import {
  beginTwoFactorSetupSchema,
  confirmTwoFactorSchema,
  twoFactorPasswordAndCodeSchema,
} from "../auth/auth.schemas";

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
    forms: [
      /* --- Company & formatting ------------------------------------------ */
      {
        name: "Company & formatting",
        on: "/settings",
        opens:
          "Settings, Company & formatting section: edited in place, Save changes at the foot",
        saves: ["PATCH /settings"],
        schema: updateSettingsSchema,
        fields: {
          companyEtin: "the company's 12-digit e-TIN",
          companyBin: "the company's 13-digit BIN",
          companyLegalNote: "printed beside the company name on a payslip",
          payslipSignatoryName: "who signs every payslip",
          fiscalYearMode:
            "bd_july_june (Bangladesh income year) or calendar (January to December)",
          tdsReminderDays:
            "days before a filing date the Dashboard warns of it",
        },
        onSave:
          "Saves the company's details, the payslip letterhead, the financial year and the number format, for everybody at once; payslips and Excel exports print them. salarySplit and the fx fields are asked on no screen: leave them out.",
        permission: "settings.write",
      },
      {
        name: "Close the books",
        on: "/settings",
        opens:
          "Settings, Company & formatting section: the Closing the books card, below Save changes",
        saves: ["POST /settings/lock-books"],
        schema: lockBooksSchema,
        fields: {
          booksLockedThrough:
            "the last day closed; the date box stops at today",
        },
        onSave:
          "Nothing dated on or before that day can be added, edited or voided afterwards, by anyone, a Super Admin included. Refused when it is earlier than the day already closed: Reopen first.",
        permission: "settings.write",
      },
      {
        name: "Reopen",
        on: "/settings",
        opens:
          "Settings, Company & formatting section: Reopen, beside Close the books while the books are closed",
        saves: ["POST /settings/lock-books"],
        onSave:
          "Clears the lock, so every date can be changed again until the books are closed anew. It is recorded in What changed.",
        permission: "settings.write",
      },

      /* --- Appearance ------------------------------------------------------ */
      {
        name: "Save colours",
        on: "/settings",
        opens:
          "Settings, Appearance section: the Colours card, Save colours at its foot",
        saves: ["PUT /settings/theme"],
        schema: themeSchema,
        fields: {
          light: "every colour of the light theme, each as #rrggbb",
          dark: "every colour of the dark theme, each as #rrggbb",
        },
        onSave:
          "Every screen is drawn in these colours, for everybody at once. Refused when some text could not be read against its background.",
        permission: "settings.write",
      },
      {
        name: "Reset to the design",
        on: "/settings",
        opens:
          "Settings, Appearance section: Reset to the design on the Colours card, then Yes, reset",
        saves: ["DELETE /settings/theme"],
        onSave:
          "Forgets the saved colours: every screen goes back to the design's own, for everybody.",
        permission: "settings.write",
      },
      {
        name: "Save type",
        on: "/settings",
        opens:
          "Settings, Appearance section: the Typefaces and sizes card, Save type at its foot",
        saves: ["PUT /settings/typography"],
        schema: typographySchema,
        fields: {
          heading: "typeface, weight and size in px for headings",
          body: "the same, for the text read on every screen",
          button: "the same, for buttons",
        },
        onSave:
          "Every screen uses these typefaces and sizes, for everybody at once. Refused when a weight is one the typeface does not come in, or a size is out of its range.",
        permission: "settings.write",
      },
      {
        name: "Reset to the design",
        on: "/settings",
        opens:
          "Settings, Appearance section: Reset to the design on the Typefaces and sizes card, then Yes, reset",
        saves: ["DELETE /settings/typography"],
        onSave:
          "Forgets the saved typefaces and sizes: every screen goes back to the design's own, for everybody.",
        permission: "settings.write",
      },

      /* --- Categories ------------------------------------------------------ */
      {
        name: "Add a heading",
        on: "/settings",
        opens: "Settings, Categories section: Add heading, top right",
        saves: ["POST /categories"],
        schema: createCategorySchema,
        fields: {
          kind: "Side of the ledger: out or in; never changes later",
          parentId: "left empty: a heading sits under nothing",
          color: "its colour in charts, shared by its sub-categories",
          sortOrder: "sent as 0",
        },
        onSave:
          "Adds the heading; it is offered at once in every Category list on its side of the ledger. Refused when a heading of that name exists, or a trashed one still holds the name.",
        permission: "categories.write",
      },
      {
        name: "Add under [heading]",
        on: "/settings",
        opens: "Settings, Categories section: Sub-category, on a heading",
        saves: ["POST /categories"],
        schema: createCategorySchema,
        fields: {
          parentId: "the heading it goes under; never changes later",
          kind: "taken from the heading",
          color: "taken from the heading",
          sortOrder: "sent as 0",
        },
        onSave:
          "Adds the sub-category under the heading; payments can be filed under it at once. Refused when that name is already used under the heading, or by a trashed one.",
        permission: "categories.write",
      },
      {
        name: "Edit category",
        on: "/settings",
        opens:
          "Settings, Categories section: the pencil on a heading, or a click on a sub-category",
        saves: ["PATCH /categories/:id"],
        schema: updateCategorySchema,
        fields: {
          isActive:
            "Active: off hides it from Category lists; a heading takes its sub-categories along",
          color: "a heading's only; its sub-categories follow it",
          sortOrder: "not asked on screen",
        },
        onSave:
          "Renames it, or switches it on or off. Its side of the ledger and its heading never change, and whatever was filed under it keeps its amounts.",
        permission: "categories.write",
      },
      {
        name: "Add a category",
        // Where a payment form opens: All transactions only edits.
        on: "/expenses/other",
        opens:
          "Add a category, at the foot of a payment form's Category list; Create a heading on Expenses opens the same",
        saves: ["POST /categories"],
        schema: createCategorySchema,
        fields: {
          parentId:
            "Under: the heading it goes under, or empty for a heading of its own",
          kind: "the side of the ledger of the form it was opened from",
          color: "its colour in charts",
          sortOrder: "sent as 0",
        },
        onSave:
          "Adds the category and chooses it on the form that opened it; where it sits never changes later. Refused when the name is already used at that level, or by a trashed category.",
        permission: "categories.write",
      },

      /* --- People who can sign in ------------------------------------------ */
      {
        name: "Add someone",
        on: "/settings",
        opens:
          "Settings, People who can sign in section: Add someone, top right",
        saves: ["POST /users"],
        schema: createUserSchema,
        fields: {
          role: "super_admin, ceo, hr or cfo: what they may see and change",
          password:
            "their first password, at least 12 characters, handed over once",
          mustChangePassword: "always on from this form",
        },
        onSave:
          "Creates an Active sign-in; at first sign-in they must choose their own password. Refused when the email is already used, by a live sign-in or by one in Trashed.",
        permission: "users.manage",
      },
      {
        name: "Edit",
        on: "/settings",
        opens:
          "Settings, People who can sign in section: Edit, on a person's row (the drawer carries their name)",
        saves: ["PATCH /users/:id"],
        schema: updateUserSchema,
        fields: {
          role: "super_admin, ceo, hr or cfo",
          status: "active, invited or disabled; disabled cannot sign in",
        },
        onSave:
          "Changes their name, role or status; the email never changes. A new role, or Disabled, signs them out everywhere at once. Refused when it would leave no active Super Admin.",
        permission: "users.manage",
      },
      {
        name: "Disable this account?",
        on: "/settings",
        opens:
          "Settings, People who can sign in section: Deactivate, on a person's row other than your own",
        saves: ["PATCH /users/:id"],
        onSave:
          "Sets their status to Disabled: signed out everywhere at once, and no sign-in until somebody sets them Active again in Edit. Refused for the last active Super Admin.",
        permission: "users.manage",
      },
      {
        name: "New password for [name]",
        on: "/settings",
        opens:
          "Settings, People who can sign in section: Set a new password (the key), on a person's row",
        saves: ["POST /users/:id/reset-password"],
        schema: resetPasswordSchema,
        fields: {
          newPassword:
            "at least 12 characters; suggested on screen, handed over once",
          mustChangePassword: "always on from this form",
        },
        onSave:
          "Replaces their password, lifts any lockout and ends every session they have; they must choose their own at their next sign-in.",
        permission: "users.manage",
      },

      /* --- The trash: the delete on every list, and Settings → Trashed ----- */
      {
        name: "Move to trash",
        on: "/transactions",
        opens:
          "Move to trash (the bin) at the end of a row, on every list that deletes: entries, transfers, plans, payroll runs, bank advices, invoices, team members, salary records, categories, sign-ins; confirmed with a tick and the word trash",
        saves: ["POST /trash/:kind/:id"],
        fields: {
          reason: "Why, for the record: optional, shown beside it in Trashed",
        },
        onSave:
          "Hides the row everywhere; a money row is voided too, leaving every total, and a transfer takes its other half. It waits in Settings, Trashed. Needs the role's write permission for that kind; refused if an account would fall below zero.",
      },
      {
        name: "Move those [n] to the trash?",
        on: "/transactions",
        opens:
          "Move to trash, in the bar that appears once rows are ticked: entries, cash in, other expenses, transfers, plans, payroll runs, team, salary records, sign-ins",
        saves: ["POST /trash/:kind/bulk"],
        fields: {
          reason:
            "Why, for the record: optional, the same for every ticked row",
        },
        onSave:
          "As one row's Move to trash, for up to 200 ticked rows of one kind, all or nothing: if any one cannot go, none goes, and the answer names it.",
      },
      {
        name: "Restore",
        on: "/settings",
        opens: "Settings, Trashed section: Restore, on a row",
        saves: ["POST /trash/:kind/:id/restore"],
        onSave:
          "Puts the row back where it was, with what went with it (a transfer's other half, a heading's sub-categories); a money row counts again. Refused when it clashes with something recorded since, or an account would fall below zero.",
      },
      {
        name: "Restore those [n]?",
        on: "/settings",
        opens:
          "Settings, Trashed section: Restore, in the bar that appears once rows are ticked",
        saves: ["POST /trash/:kind/bulk-restore"],
        onSave:
          "Restores each ticked row as Restore does, one request per kind. Rows that cannot come back stay in Trashed, and the answer says how many and why.",
      },
      {
        name: "Delete this [kind] for good?",
        on: "/settings",
        opens:
          "Settings, Trashed section: the X at the end of a row; confirmed with a tick and the word delete",
        saves: ["DELETE /trash/:kind/:id"],
        onSave:
          "Removes the row from the database for ever; only What changed keeps what it said. Refused while other records still point at it, such as ledger entries or payroll lines.",
      },
      {
        name: "Delete those [n] for good?",
        on: "/settings",
        opens:
          "Settings, Trashed section: Delete for ever, in the bar that appears once rows are ticked",
        saves: ["POST /trash/:kind/bulk-purge"],
        onSave:
          "Removes each ticked row for ever, as the X does, one request per kind. Rows other records still point at stay in Trashed, and the answer says how many.",
      },
      {
        name: "Empty the trash",
        on: "/settings",
        opens:
          "Settings, Trashed section: Empty the trash, top right; confirmed with a tick and the word delete",
        saves: ["DELETE /trash"],
        onSave:
          "Removes for ever everything in Trashed of the kinds this role may delete; other roles' kinds stay. A kind other records still point at stays too, and the answer names it.",
      },

      /* --- Email ------------------------------------------------------------ */
      {
        name: "Resend API key",
        on: "/settings",
        opens:
          "Settings, Email section: the Resend API key box on the Sending card, then Save beside it",
        saves: ["POST /email/key"],
        fields: {
          apiKey: "the key from resend.com, API Keys; it starts with re_",
        },
        onSave:
          "Stores the key encrypted, replacing any saved one; it is never shown again. A key not starting with re_ is refused. Nothing is sent while Send email is off.",
        permission: "settings.write",
      },
      {
        name: "Sending",
        on: "/settings",
        opens:
          "Settings, Email section: the Sending card; each address saves when its box is left, each switch when flipped",
        saves: ["POST /email/settings"],
        fields: {
          from: "Mail appears to be from: an address on a Resend-verified domain",
          adminAddress:
            "Copy every reminder to: one more address every reminder goes to",
          enabled: "Send email: nothing is sent while it is off",
          toStaff: "also send to every active CFO and Super Admin sign-in",
        },
        onSave:
          "Saves that one setting at once. Renewal reminders go out at 9am Dhaka time for plans renewing within three days, to the plan's login email, these addresses, and the staff if switched on.",
        permission: "settings.write",
      },
      {
        name: "Send a test",
        on: "/settings",
        opens: "Settings, Email section: Send a test, on the Sending card",
        saves: ["POST /email/test"],
        onSave:
          "Sends a test message to the person pressing it and to the Copy every reminder to address, and says which Resend accepted. Refused while there is no key, no from-address, or Send email is off.",
        permission: "settings.write",
      },
      {
        name: "Run today's reminders now",
        on: "/settings",
        opens:
          "Settings, Email section: beside Send a test, on the Sending card",
        saves: ["POST /email/run-reminders"],
        onSave:
          "Runs the 9am job at once: a reminder email for every active plan renewing within three days. Whoever was already told about that renewal is not told again; the answer says how many went.",
        permission: "settings.write",
      },

      /* --- Notifications: the switches, and the bell on every page ---------- */
      {
        name: "What raises a notification",
        on: "/settings",
        opens:
          "Settings, Notifications section: the switch on an event's row; it saves when flipped",
        saves: ["POST /notifications/settings"],
        fields: {
          renewals: "A plan renews in three days",
          tdsDeadline:
            "The TDS deposit deadline is near, with something undeposited",
          payrollUnpaid: "A month ended and its payroll is not paid",
          hrBudget: "HR sent a money request",
          significantChanges:
            "a voided money row or a pay change; Super Admins only, off at first",
        },
        onSave:
          "Saves that switch at once, for everybody: switched off, that event no longer rings the bell in the top bar. The renewal email has its own switch, under Email.",
        permission: "settings.write",
      },
      {
        name: "Check now",
        on: "/settings",
        opens: "Settings, Notifications section: Check now, in the Try it band",
        saves: ["POST /notifications/run"],
        onSave:
          "Runs the 9am check at once against today's data and raises what the switched-on events find: renewals, TDS deadlines, unpaid payroll, significant changes. Nothing already raised is raised twice.",
        permission: "settings.write",
      },
      {
        name: "Notifications",
        on: "/",
        opens:
          "The bell in the top bar, on every page: a click on one notification in its list",
        saves: ["POST /notifications/:id/read"],
        onSave:
          "Marks that notification read for the person clicking, and opens where it points, if anywhere. Only their own bell changes.",
      },
      {
        name: "Mark all read",
        on: "/",
        opens:
          "The bell in the top bar, on every page: Mark all read, at the top of its list",
        saves: ["POST /notifications/read-all"],
        onSave:
          "Marks every unread notification of the person's own as read, and the bell's count clears. Nobody else's bell changes.",
      },

      /* --- Connections ------------------------------------------------------ */
      {
        name: "Connect",
        on: "/settings",
        opens:
          "Settings, Connections section: paste the key or Choose the .json file, then Connect (Replace the key once one is saved)",
        saves: ["POST /connections/google/key"],
        schema: setGoogleKeySchema,
        fields: {
          serviceAccount:
            "the whole service-account JSON file Google downloads",
        },
        onSave:
          "Checks the key with Google, then stores it encrypted; it is never shown again. The card then shows the address to share Sheets and Docs with. Refused when it is not a service-account key or Google turns it down.",
        permission: "settings.write",
      },
      {
        name: "Remove the Google Cloud key?",
        on: "/settings",
        opens:
          "Settings, Connections section: Remove, beside Test once a key is saved",
        saves: ["DELETE /connections/google/key"],
        onSave:
          "Deletes the key. Shared Sheets and Docs can no longer be read, and an Assistant set to Google Cloud goes back to the Anthropic key and Claude.",
        permission: "settings.write",
      },
      {
        name: "Test",
        on: "/settings",
        opens:
          "Settings, Connections section: Test, beside Copy address once a key is saved",
        saves: ["POST /connections/google/test"],
        onSave:
          "Changes nothing. Asks Google, with the saved key, whether Claude on Vertex AI, Gemini, Sheets, Docs and Drive answer, and lists each as ready or why not.",
        permission: "settings.write",
      },

      /* --- Your sign-in: each person's own two-step sign-in ---------------- */
      {
        name: "Set up two-step sign-in",
        on: "/settings",
        opens:
          "Settings, Your sign-in section: Set up two-step sign-in, then Continue",
        saves: ["POST /auth/2fa/setup"],
        schema: beginTwoFactorSetupSchema,
        fields: { password: "the person's own sign-in password, asked again" },
        onSave:
          "Shows a QR code, and its key, for an authenticator app, once. Nothing is switched on until Turn it on.",
      },
      {
        name: "Turn it on",
        on: "/settings",
        opens:
          "Settings, Your sign-in section: under the QR code that Set up two-step sign-in shows",
        saves: ["POST /auth/2fa/confirm"],
        schema: confirmTwoFactorSchema,
        fields: { code: "the six digits the authenticator app shows" },
        onSave:
          "Switches two-step sign-in on for the person's own account and shows their recovery codes, once. From then on, signing in asks for a code from the app after the password.",
      },
      {
        name: "Get new recovery codes",
        on: "/settings",
        opens:
          "Settings, Your sign-in section: New recovery codes, or turn this off",
        saves: ["POST /auth/2fa/recovery-codes"],
        schema: twoFactorPasswordAndCodeSchema,
        fields: {
          password: "the person's own sign-in password",
          code: "from the authenticator app, or a recovery code",
        },
        onSave:
          "Replaces every unused recovery code of the person's own with new ones, shown once.",
      },
      {
        name: "Turn two-step off",
        on: "/settings",
        opens:
          "Settings, Your sign-in section: New recovery codes, or turn this off",
        saves: ["POST /auth/2fa/disable"],
        schema: twoFactorPasswordAndCodeSchema,
        fields: {
          password: "the person's own sign-in password",
          code: "from the authenticator app, or a recovery code",
        },
        onSave:
          "Switches two-step sign-in off for the person's own account and deletes every unused recovery code; signing in asks for the password alone again.",
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
