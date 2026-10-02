import { appPart } from "../../common/app-map";
import {
  adviceInputSchema,
  fromPayrollSchema,
  lineInputSchema,
} from "./bank-format";

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
    forms: [
      {
        name: "New bank advice from payroll",
        on: "/payroll/bank-advice",
        opens: "New from payroll, top right",
        saves: ["POST /bank-advices/from-payroll"],
        schema: fromPayrollSchema,
        fields: {
          payrollRunId: "the salary sheet it is built from",
          accountId:
            "the account it is paid from; the sheet's own when left out",
          valueDate: "the day the bank pays; today or later",
          paymentDetails:
            "printed on each person's statement, like Salary and the month",
          paymentType: "PAY payroll, ACH or RTGS another bank, BT SCB to SCB",
          includeEmails:
            "fill each person's email, so the bank confirms to them",
        },
        onSave:
          "Builds an advice with one payment for each person on the sheet, from their bank details on Team. Anyone with nothing to pay, or paid to a mobile wallet, is left out and named; then the advice opens. Nothing moves in the books.",
        permission: "payroll.pay",
      },
      {
        name: "New blank bank advice",
        on: "/payroll/bank-advice",
        opens: "Blank advice, top right",
        saves: ["POST /bank-advices"],
        schema: adviceInputSchema,
        fields: {
          title: "its name",
          debitAccountNo:
            "the Standard Chartered account paid from; the file adds two zeros",
          debitCityCode: "three letters, DHK for Dhaka",
          valueDate: "the day the bank pays; today or later",
        },
        onSave:
          "Creates an empty advice, for payments that are not a salary sheet, and opens it so its payments can be added. Nothing moves in the books.",
        permission: "payroll.pay",
      },
      {
        name: "Edit the advice",
        on: "/payroll/bank-advice/[id]",
        opens: "Edit details, above the payments",
        saves: ["PATCH /bank-advices/:id"],
        schema: adviceInputSchema,
        onSave:
          "Saves the advice's name, account, debit account number, city code, value date and note. Its payments do not change.",
        permission: "payroll.pay",
      },
      {
        name: "Add a payment",
        on: "/payroll/bank-advice/[id]",
        opens: "Add payment, above the payments",
        saves: ["POST /bank-advices/:id/lines"],
        schema: lineInputSchema,
        fields: {
          paymentType: "PAY payroll, ACH or RTGS another bank, BT SCB to SCB",
          beneficiaryName: "as the bank account holds it, in English letters",
          bankCode:
            "SCBLBDDXXXX for Standard Chartered, else the routing number",
          accountNo: "digits; spaces, dots and dashes are taken out",
          paymentDetails: "printed on their bank statement",
          email: "the bank sends them a confirmation",
        },
        onSave:
          "Adds the payment as the advice's last row. Anything that still stops the file, like a missing bank code, is listed on that row. Nothing moves in the books.",
        permission: "payroll.pay",
      },
      {
        name: "Payment to <beneficiary>",
        on: "/payroll/bank-advice/[id]",
        opens: "Edit, on a payment's row",
        saves: ["PATCH /bank-advices/:id/lines/:lineId"],
        schema: lineInputSchema,
        fields: {
          bankCode:
            "SCBLBDDXXXX for Standard Chartered, else the routing number",
          email: "the bank sends them a confirmation",
        },
        onSave:
          "Saves that payment's row as typed. The salary sheet and the person's record on Team do not change.",
        permission: "payroll.pay",
      },
      {
        name: "Take this payment off the advice?",
        on: "/payroll/bank-advice/[id]",
        opens: "Delete, on a payment's row",
        saves: ["DELETE /bank-advices/:id/lines/:lineId"],
        onSave:
          "Takes the payment off this file for good. The salary sheet and the person's record do not change; Add payment puts it back by hand.",
        permission: "payroll.pay",
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
