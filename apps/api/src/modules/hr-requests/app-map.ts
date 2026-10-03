import { appPart } from "../../common/app-map";
import { decisionSchema } from "./hr-requests.schemas";

/** What every decision's two fields mean: the same drawer for all four. */
const DECISION_FIELDS = {
  decision: "set by the button pressed, never typed",
  note: "the decider's own words, which HR reads",
};

export const HR_REQUESTS_MAP = [
  appPart({
    key: "hr_requests",
    name: "HR Requests",
    modules: ["hr-requests"],
    purpose:
      "Every money request the HR portal sends, on one page: a pay change, a one-off amount for a month's salary sheet, a budget, and a spend against a budget. Each changes nothing until the CFO or the Super Admin approves it; a refusal and a hold write nothing.",
    keeps: [
      "A pay change for somebody: it waits here, and only an approval writes it into their salary history.",
      "A one-off amount for a month's sheet, a budget, a spend: each waits here for a decision.",
    ],
    screens: [
      {
        href: "/hr-requests",
        name: "HR Requests",
        does: "The queue, filtered by state (Waiting, To pay, Approved, Rejected, Withdrawn, All), kind and month. A row opens the request; Approve, Reject and Hold are decided there, and a decided one can be put back to waiting. An approved spend is paid there: straight after approving it (Pay now), or later from To pay, which lists the spends approved and not yet paid.",
      },
    ],
    forms: [
      {
        name: "Approve",
        on: "/hr-requests",
        opens: "Approve, on a waiting request's row or in its pop-up",
        saves: ["POST /hr-requests/:kind/:id/decision"],
        schema: decisionSchema,
        fields: DECISION_FIELDS,
        onSave:
          "The only decision that writes. A pay change goes into the person's salary history from its date; a one-off onto its month's salary sheet as bonus, refused once that sheet is finalised; a budget is agreed; a spend can then be paid, and whoever may pay it is asked at once: Pay now opens the payment, Pay later leaves it on To pay. HR is told.",
        permission: "hrrequests.decide",
      },
      {
        name: "Hold",
        on: "/hr-requests",
        opens: "Hold, on a pending request's row or in its pop-up",
        saves: ["POST /hr-requests/:kind/:id/decision"],
        schema: decisionSchema,
        fields: DECISION_FIELDS,
        onSave:
          "Puts it on hold with the note, which is required. Nothing moves; it stays in the waiting list, and a salary sheet it affects cannot be built until it is decided.",
        permission: "hrrequests.decide",
      },
      {
        name: "Reject",
        on: "/hr-requests",
        opens: "Reject, on a waiting request's row or in its pop-up",
        saves: ["POST /hr-requests/:kind/:id/decision"],
        schema: decisionSchema,
        fields: DECISION_FIELDS,
        onSave:
          "Rejects it with the note, which is required. Nothing moves, for good: if it is wanted after all, HR sends a new request.",
        permission: "hrrequests.decide",
      },
      {
        name: "Put back to waiting",
        on: "/hr-requests",
        opens: "Put back to waiting, in a decided request's pop-up",
        saves: ["POST /hr-requests/:kind/:id/decision"],
        schema: decisionSchema,
        fields: DECISION_FIELDS,
        onSave:
          "It waits again, undecided. Refused once an approval has moved money: a pay change approved, a one-off on a sheet, a spend paid. A correction then is a new request from HR.",
        permission: "hrrequests.decide",
      },
    ],
    recordedBy: ["POST /hr-requests/:kind/:id/decision"],
    permission: "hrrequests.read",
    assistant: {
      drafts: [],
      reads: ["hr_requests"],
      otherwise:
        "I cannot approve, reject, hold or pay a request, and I cannot send one: requests come from the HR portal and are decided on HR Requests. I can tell you what is waiting, never the pay figure in a pay change.",
    },
  }),
];
