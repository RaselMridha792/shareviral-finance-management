import { appPart } from "../../common/app-map";

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
