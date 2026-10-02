import { appPart } from "../../common/app-map";

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
        does: "The queue, filtered by kind, state and month. A row opens the request; Approve, Reject and Hold are decided there, and an approved spend is paid there.",
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
