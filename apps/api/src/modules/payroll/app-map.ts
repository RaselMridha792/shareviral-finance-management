import {
  createPayrollRunSchema,
  payPayrollSchema,
  setRunFxRateSchema,
  syncRunMembersSchema,
  updatePayrollLineSchema,
} from "@finance/shared";

import { appPart } from "../../common/app-map";

export const PAYROLL_MAP = [
  appPart({
    key: "payroll",
    name: "Payroll",
    modules: ["payroll"],
    purpose:
      "Salaries, one salary sheet a month. The sheet is generated from the team, each person's tax is worked out by the year's rule and can be typed over, the sheet is finalised (nothing moves), then marked paid (the net pay leaves the bank; the tax stays held until it is deposited). Contractors are never on the sheet.",
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
      {
        href: "/payroll/[runId]/payslip",
        name: "Salary Payslip",
        does: "One person's payslip for one month, in the company's own design: earnings, deductions with the tax, the net in figures and words, the pay period and the signatory. Print or save as PDF; nothing is changed here. Opened from Payslip on a paid row of a salary sheet, from a person's page, or from TDS.",
      },
    ],
    forms: [
      {
        name: "Start a payroll month",
        on: "/payroll",
        opens: "New month, top right",
        saves: ["POST /payroll/runs", "POST /payroll/runs/:id/members"],
        schema: createPayrollRunSchema,
        fields: {
          periodMonth: "1 to 12; a month not yet reached is not offered",
        },
        onSave:
          "Starts that month's salary sheet as a draft and puts the people ticked on the form on it, at their pay on record. Refused if the month already has a sheet, even one in the trash, or while HR has a request for it waiting.",
        permission: "payroll.write",
      },
      {
        name: "Who is on this month",
        on: "/payroll/[runId]",
        opens: "People, top right of a draft sheet",
        saves: ["POST /payroll/runs/:id/members"],
        schema: syncRunMembersSchema,
        fields: {
          teamMemberIds:
            "everyone the sheet should hold: the whole list, not a change",
        },
        onSave:
          "Gives the sheet exactly the people ticked: a line built for each one added, the line taken off for each one unticked. Everyone kept keeps every figure typed for them. Refused while HR has a request for the month waiting.",
        permission: "payroll.write",
      },
      {
        name: "Build list",
        on: "/payroll/[runId]",
        opens:
          "Build list (Rebuild list once it has lines), top right of a draft sheet",
        saves: ["POST /payroll/runs/:id/generate-lines"],
        onSave:
          "Starts the sheet again: a line for every employee employed that month, at the pay on record, tax by the year's rule, approved HR one-offs in Bonus. Figures typed since are lost. People with no pay on record are left out and named.",
        permission: "payroll.write",
      },
      {
        name: "Set their pay from the joining salary",
        on: "/payroll/[runId]",
        opens:
          "Under the note on a draft sheet after Build list or People left people out for having no pay",
        saves: ["POST /team-members/compensation/from-joining-salary"],
        onSave:
          "Gives every employee with no pay on record their joining salary as pay, from their own joining date. Anyone who already has pay is untouched; anyone with no joining salary is named. Build the list again afterwards.",
        permission: "team.compensation.write",
      },
      {
        name: "Work out the tax again",
        on: "/payroll/[runId]",
        opens: "Work out the tax again, top right of a draft sheet with lines",
        saves: ["POST /payroll/runs/:id/recalculate-tds"],
        onSave:
          "Works every line's tax out again by the year's rule, replacing tax typed by hand, and says how many figures changed. Nothing else on the sheet moves.",
        permission: "payroll.write",
      },
      {
        name: "USD rate for this sheet",
        on: "/payroll/[runId]",
        opens:
          "Fill the empty rows, or Replace every row, above a draft sheet's table",
        saves: ["POST /payroll/runs/:id/fx-rate"],
        schema: setRunFxRateSchema,
        fields: {
          fxRate: "taka per dollar",
          overwrite: "true for Replace every row; false fills rows with none",
        },
        onSave:
          "Writes the rate onto the sheet's unpaid rows, for the Net Pay (USD) column; each row's rate stays editable. Nothing moves in the books.",
        permission: "payroll.write",
      },
      {
        name: "A row of the sheet",
        on: "/payroll/[runId]",
        opens:
          "Typing in a draft sheet's row: Bonus, Other +, Working Days, Gross, TDS, Other −, Net Pay or FX Rate. Each box saves when left",
        saves: ["PATCH /payroll/lines/:id"],
        schema: updatePayrollLineSchema,
        fields: {
          workingDays:
            "days worked; re-figures gross, its parts and tax. Null: whole month",
          tdsAmount:
            "tax typed by hand; kept until the tax is worked out again",
          netAmount: "typed over the sum, it is what is paid. Null undoes it",
          fxRate: "taka per dollar, for this row's USD column only",
          remarks: "printed on the payslip; the sheet has no box for it",
        },
        onSave:
          "Saves that figure on the line and the sheet's totals. A new gross or days works the tax out again unless it was typed; changing any part clears a typed net. Refused once the sheet is finalised.",
        permission: "payroll.write",
      },
      {
        name: "Finalise",
        on: "/payroll/[runId]",
        opens: "Finalise, top right of a draft sheet with lines",
        saves: ["POST /payroll/runs/:id/finalize"],
        onSave:
          "Locks the sheet's figures; nothing moves in the books. Its payslips then exist, its tax is listed on TDS, and Mark paid appears. Refused while HR has a request for that month waiting.",
        permission: "payroll.write",
      },
      {
        name: "Reopen",
        on: "/payroll/[runId]",
        opens:
          "Reopen, top right of a finalised sheet; on a paid one, Edit and then Try to reopen",
        saves: ["POST /payroll/runs/:id/reopen"],
        onSave:
          "Puts the sheet back to draft so its figures can change, and clears its payment. Refused while any salary entry it wrote is still live: those are voided on All transactions first.",
        permission: "payroll.write",
      },
      {
        name: "Pay <month>",
        on: "/payroll/[runId]",
        opens: "Mark paid, top right of a finalised sheet",
        saves: ["POST /payroll/runs/:id/pay"],
        schema: payPayrollSchema,
        fields: {
          paymentDate: "the day the salaries left the account",
          accountId: "the account the salaries leave from",
          paymentMode:
            "consolidated: one ledger entry; individual: one per person",
          paymentMethod: "the screen always sends bank_transfer",
          usdRate: "taka per dollar that day, as on every ledger entry",
        },
        onSave:
          "Writes the net pay out of that account under Salary, as one entry or one per person, onto All transactions; the sheet becomes paid. The tax stays held until deposited. Refused for a date in closed books, or if the account would go below zero.",
        permission: "payroll.pay",
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
