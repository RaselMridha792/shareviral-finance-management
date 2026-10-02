import { appPart } from "../../common/app-map";

export const TEAM_MAP = [
  appPart({
    key: "team",
    name: "Team",
    modules: ["team-members"],
    purpose:
      "The people who work here, employees and contractors: who they are, their role, when they joined, their bank details and papers. What somebody is paid is kept apart, in a salary history only finance changes; a pay change sent by HR waits under HR Requests.",
    keeps: [
      "A person: name, designation, department, employee or contractor, joining date, contact and bank details.",
      "Not pay. A salary figure is typed on the team form or decided under HR Requests, never through the Assistant.",
    ],
    screens: [
      {
        href: "/team",
        name: "Team",
        does: "Everybody on the team. A row opens the person's page; Add person adds somebody.",
      },
      {
        href: "/team/[id]",
        name: "A person's own page",
        does: "One person: their details, their papers and the tools they are on.",
      },
    ],
    recordedBy: ["POST /team-members"],
    permission: "team.read",
    assistant: {
      drafts: ["team_member"],
      reads: ["team_members", "find_party"],
      otherwise:
        "I cannot change somebody already on the team, and I never record or report what anybody is paid. Both are done on the person's page under Team.",
    },
  }),
];
