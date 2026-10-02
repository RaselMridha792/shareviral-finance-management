import { appPart } from "../../common/app-map";

export const BANK_ADVICES_MAP = [
  appPart({
    key: "bank_advice",
    name: "Bank Advice",
    modules: ["bank-advices"],
    purpose:
      "The payment file sent to the bank each month to pay the salaries: one line a person, with their account, bank code and amount. It is built from a salary sheet and downloaded in the bank's own format. It is an instruction to the bank, not an entry in the ledger: the salaries enter the books when the sheet is marked paid.",
    keeps: [
      "A month's bank advice and its lines. Moves no money in the books by itself.",
    ],
    screens: [
      {
        href: "/payroll/bank-advice",
        name: "Bank Advice",
        does: "Every advice, with how many payments it holds and its total. A new one is built from a salary sheet here.",
      },
      {
        href: "/payroll/bank-advice/[id]",
        name: "One bank advice",
        does: "Its payments, what is still missing on any of them, and the two downloads for the bank.",
      },
    ],
    recordedBy: ["POST /bank-advices/from-payroll", "POST /bank-advices"],
    permission: "payroll.read",
    assistant: {
      drafts: [],
      reads: ["bank_advices"],
      otherwise:
        "I cannot build, change or download a bank advice. That is done on Bank Advice, under Payroll & Bank.",
    },
  }),
];
