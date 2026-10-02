import { appPart } from "../../common/app-map";

export const PAYROLL_MAP = [
  appPart({
    key: "payroll",
    name: "Payroll",
    modules: ["payroll"],
    purpose:
      "Salaries, one salary sheet a month. The sheet is generated from the team, each person's tax is typed, the sheet is finalised (nothing moves), then marked paid (the net pay leaves the bank; the tax stays held until it is deposited). Contractors are never on the sheet.",
    keeps: [
      "Every salary payment. Salary is never a plain payment in the ledger: it is written by marking a salary sheet paid.",
      "A bonus or other one-off for a month: a line on that month's sheet.",
    ],
    screens: [
      {
        href: "/payroll",
        name: "Payroll",
        does: "Every month's salary sheet and where it has reached: draft, finalised or paid. A new sheet is started here.",
      },
      {
        href: "/payroll/[runId]",
        name: "A salary sheet",
        does: "One month: a line for each person, with gross, tax and net. Finalise, Mark paid and Reopen are here.",
      },
    ],
    recordedBy: ["POST /payroll/runs", "POST /payroll/runs/:id/pay"],
    permission: "payroll.read",
    assistant: {
      drafts: [],
      reads: ["payroll_status"],
      otherwise:
        "I cannot record a salary payment, build or finalise a salary sheet, or mark one paid. That is done on Payroll, on the month's salary sheet. I can tell you where each month's sheet has reached, never what one person is paid.",
    },
  }),
];
