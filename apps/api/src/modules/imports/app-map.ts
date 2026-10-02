import { appPart } from "../../common/app-map";
import { commitSchema, mappingSchema } from "./imports.schemas";

export const DATA_MAP = [
  appPart({
    key: "data",
    name: "Import and Export",
    modules: ["imports", "exports"],
    purpose:
      "Import brings a file of TRANSACTIONS into the ledger: the file is staged, its columns are mapped, every row is shown with what it would become and the duplicates flagged, and only then imported; a whole batch can be reverted afterwards. It takes transactions and nothing else — not people, not plans, not vendors. Export downloads what the app holds as files: transactions, accounts, subscriptions, a salary sheet, the team, the tax registers, the reports.",
    keeps: [
      "A file of many transactions: staged and checked here, never drafted one at a time.",
    ],
    screens: [
      {
        href: "/data",
        name: "Import and Export",
        does: "Import: stage a file, map its columns, check every row, import, or revert a batch. Export: choose what to download.",
      },
    ],
    forms: [
      {
        name: "Choose file",
        on: "/data",
        opens: "Choose file, the first step of the Import tab",
        saves: ["POST /imports"],
        fields: {
          file: "an .xlsx, .xls or .csv, its first row the column headings",
        },
        onSave:
          "Stages every row of the file as written and keeps a copy of the file; nothing reaches the ledger. Refused with no headings, no rows, or over 10,000 rows. Moves on to Match the columns.",
      },
      {
        name: "Match the columns",
        on: "/data",
        opens:
          "The second step of the Import tab, after a file is chosen; Check it at its foot",
        saves: ["POST /imports/:id/mapping"],
        schema: mappingSchema,
        fields: {
          columnMap:
            "each heading of the file → the ledger field it holds, or null to ignore it",
          defaults:
            "for every row: accountId, usdRate, dateFormat, fallbackCategoryId, assumeDirection",
        },
        onSave:
          "Reads every staged row through the mapping and marks it ready, a duplicate of an entry already in that account or earlier in the file, or a problem. Nothing reaches the ledger. Moves on to Check it.",
      },
      {
        name: "Import them",
        on: "/data",
        opens: "Import them, under Every row on the Check it step",
        saves: ["POST /imports/:id/commit"],
        schema: commitSchema,
        fields: {
          skipRows:
            "row numbers left out; duplicates start left out, rows with problems never go",
        },
        onSave:
          "Writes the ready rows to the chosen account at the file's USD rate, adding a vendor for a new payee name; they show on All transactions. Refused whole if a row is in closed books or the account would go below zero.",
      },
      {
        name: "Revert",
        on: "/data",
        opens: "Revert, on an imported file's row under Past imports",
        saves: ["POST /imports/:id/revert"],
        onSave:
          "Deletes every entry the import wrote and marks the file reverted. Refused if any of them has been edited since (void those one by one), falls in closed books, or removing them would take an account below zero.",
      },
    ],
    recordedBy: ["POST /imports", "POST /imports/:id/commit"],
    permission: "imports.run",
    assistant: {
      // It proposes where a file's rows go (an import plan) and the person
      // stages them with Send to Import; it drafts none of them itself.
      drafts: [],
      reads: [],
      otherwise:
        "I cannot import or export anything myself. For an attached file of transactions I can propose the account, the columns and the category, and Send to Import stages it on Import and Export, where every row is checked before anything is recorded.",
    },
  }),
];
