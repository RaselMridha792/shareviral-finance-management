import { appPart } from "../../common/app-map";

/**
 * The TDS screen was cut down, on the owner's instruction, to the salary
 * register and a calculator. Challans (`tds_deposits`) and the quarterly
 * returns are still recorded and their endpoints still answer, but no screen
 * lists them today: a challan's number is read on the salary row it was
 * deposited for.
 */
export const TDS_MAP = [
  appPart({
    key: "tds",
    name: "TDS",
    modules: ["tds"],
    purpose:
      "Tax deducted at source: what was withheld from salaries and from suppliers' bills, against what was deposited to the treasury by challan. Quarterly returns are due on 25 October, January, April and July.",
    keeps: [
      "A challan: tax deposited to the treasury, with its number, its dates and the month it is for. Given an account, it also writes the payment into the ledger.",
      "The challan number against one person's salary deduction: typed on that person's row.",
      "Tax withheld from a supplier's bill is not recorded here: it is given on the payment itself, as the gross bill and the tax withheld.",
    ],
    screens: [
      {
        href: "/tax/withholding",
        name: "TDS",
        does: "Who was taxed in a period and how much, with the challan number against each, and a tax calculator. No screen lists the challans themselves today.",
      },
    ],
    recordedBy: [
      "POST /tds/deposits",
      "PATCH /tds/salary-deductions/:id/challan",
    ],
    permission: "tds.read",
    assistant: {
      drafts: ["tds_deposit"],
      reads: ["tax_status"],
      otherwise:
        "I cannot write a challan number onto somebody's salary row, change the tax policy or file a return. The first is done on the person's row on the TDS screen.",
    },
  }),
];
