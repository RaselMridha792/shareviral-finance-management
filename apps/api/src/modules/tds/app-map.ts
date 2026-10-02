import {
  createTdsDepositSchema,
  saveTdsPolicySchema,
  setLineChallanSchema,
} from "@finance/shared";

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
    forms: [
      {
        name: "Challan for this deduction",
        on: "/tax/withholding",
        opens: "Edit (the pencil), on a salary row",
        saves: ["PATCH /tds/salary-deductions/:id/challan"],
        schema: setLineChallanSchema,
        fields: {
          challanNumber: "as on the A-Challan; left empty, it clears the row's",
          applyToMonth: "also write it on every other taxed row of that month",
        },
        onSave:
          "Writes the number on that salary row, or on every taxed row of its month when asked. It records no deposit and moves no money. Refused while that month's salary sheet is a draft. A scan chosen here is attached after.",
        permission: "tds.write",
      },
      {
        name: "Take this challan off the row?",
        on: "/tax/withholding",
        opens: "Delete (the bin), on a salary row that has a challan",
        saves: ["PATCH /tds/salary-deductions/:id/challan"],
        onSave:
          "Clears the number from that one row, which reads as not yet deposited again. The scan stays attached, and shows again when the number is typed back.",
        permission: "tds.write",
      },
      {
        name: "Salary TDS",
        on: "/settings",
        opens: "the Salary TDS section, for the income year chosen at its top",
        saves: ["POST /tds/policy/:year"],
        schema: saveTdsPolicySchema,
        fields: {
          exemptionNumerator:
            "with exemptionDenominator, the untaxed fraction of salary: 1 and 3 for a third",
          exemptionCap: "the most of a year's salary left untaxed",
          exemptionMode: "lower, fraction or cap: which of the two applies",
          slabs: "the bands, each a width and a rate; only the last open",
          rebate:
            "the investment rebate's rates, its ceiling, and the full-investment switch",
          minimumTax: "the floor for anybody taxed above the first band",
        },
        onSave:
          "Writes the rule for the income year chosen. Salary sheets built from then on work their TDS out with it; one already built keeps what it was built with. A year without a rule of its own uses the latest earlier one.",
        permission: "settings.write",
      },
      {
        name: "The draft",
        on: "/assistant",
        opens: "the card you write a TDS challan on, in the chat",
        saves: ["POST /tds/deposits"],
        schema: createTdsDepositSchema,
        fields: {
          depositDate: "the day the bank took it; never before challanDate",
          periodMonth:
            "with periodYear, the month whose withheld tax it settles",
          depositType: "salary, vendor, or mixed for both: whose withheld tax",
          accountId:
            "the account it was paid from; with one, the ledger entry is written",
          usdRate: "taka for one dollar that day; needed with an account",
        },
        onSave:
          "Records the challan and, with an account, the money-out entry on the deposit date, under TDS deposit. Refused in a closed month, for a challan already recorded, or if the account would go below zero. The entry shows on All transactions; no screen lists challans or has a form for one.",
        permission: "tds.write",
        draft: "tds_deposit",
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
        "I cannot write a challan number onto somebody's salary row, change the tax policy or file a return. The first is done on the person's row on the TDS screen; the tax policy under Settings, Salary TDS.",
    },
  }),
];
