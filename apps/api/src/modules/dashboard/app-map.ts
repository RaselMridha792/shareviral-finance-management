import { appPart } from "../../common/app-map";

/** The dashboard has no endpoints of its own: it reads `GET /reports/overview`. */
export const DASHBOARD_MAP = [
  appPart({
    key: "dashboard",
    name: "Dashboard",
    modules: ["dashboard"],
    purpose:
      "The first screen: the period's money in and out, what the accounts hold, what is due soon, and ways into the other screens. A reader with no money permission sees the tax deadlines only.",
    keeps: ["Nothing. Every figure on it comes from the other parts."],
    screens: [
      {
        href: "/",
        name: "Dashboard",
        does: "The period at a glance, with links into each part.",
      },
    ],
    forms: [],
    recordedBy: [],
    permission: "dashboard.view",
    assistant: {
      drafts: [],
      reads: ["period_summary", "account_balances"],
      otherwise:
        "Nothing is recorded on the Dashboard. It shows what the other screens hold.",
    },
  }),
];
