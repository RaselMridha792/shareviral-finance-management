import {
  createTeamMemberSchema,
  setCompensationSchema,
  setTeamSocialsSchema,
  updateTeamMemberSchema,
  upsertEreturnSchema,
} from "@finance/shared";

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
    forms: [
      {
        name: "Add a person",
        on: "/team",
        opens: "Add person, top right",
        saves: ["POST /team-members"],
        schema: createTeamMemberSchema,
        fields: {
          engagementType:
            "employee is on the salary sheet; a contractor bills, never on it",
          employmentType:
            "where and on what footing they work; payroll ignores it",
          photoUrl: "a link; the form uploads the photo as a file instead",
          joiningSalary: "agreed at hire; typed by a person, never drafted",
          currentSalary:
            "monthly gross paid now; needs the pay permission; never drafted",
          previousOrgSalary:
            "what the last employer paid; sent by the HR portal",
        },
        onSave:
          "Adds the person to Team. Current salary, or else an employee's joining salary, becomes their pay from the joining date, which the salary sheet reads. A photo, CV or appointment letter chosen on the form uploads after, onto their page. An employee ID somebody already has is refused.",
        permission: "team.write",
        draft: "team_member",
        // The four columns of Team that read "N/A" for somebody added
        // without them (4 Oct 2026).
        worthAsking: [
          {
            field: "employeeCode",
            shows: "Employee ID",
            ask: "their employee ID",
          },
          {
            field: "designation",
            shows: "Designation",
            ask: "their designation",
          },
          {
            field: "employmentType",
            shows: "Employment type",
            ask: "onsite, remote, hybrid or contractual",
          },
          {
            field: "department",
            shows: "Department",
            ask: "their department",
          },
        ],
      },
      {
        name: "Edit person",
        on: "/team/[id]",
        opens:
          "Edit record, top right of a person's page; or Edit on a row of Team",
        saves: ["PATCH /team-members/:id"],
        schema: updateTeamMemberSchema,
        fields: {
          status:
            "Working, On leave, Resigned or Let go; the salary sheet ignores it",
          endedOn: "their last day; sheets for later months leave them out",
          currentSalary:
            "monthly gross now; a change becomes pay from today; never drafted",
          joiningSalary: "agreed at hire; typed by a person, never drafted",
          employeeCode:
            "the company's own ID, one person each; blank clears it",
        },
        onSave:
          "Saves the record on their page. A changed Current salary becomes their pay from today. A corrected joining salary moves the pay taken from it, but months already on a finalised sheet keep the old figure. An employee ID somebody already has is refused.",
        permission: "team.write",
      },
      {
        name: "Change status",
        on: "/team/[id]",
        opens:
          "Change status, top right of a person's page (the same button on a row of Team opens that page)",
        saves: ["PATCH /team-members/:id"],
        fields: {
          status: "Working, On leave, Resigned or Let go",
          endedOn: "Last day, asked only when they are leaving",
        },
        onSave:
          "Saves the status and last day on their record. The last day, not the status, keeps them off salary sheets for the months after it; On leave alone does not. Nothing already recorded is removed.",
        permission: "team.write",
      },
      {
        name: "Set <person>'s pay",
        on: "/team/[id]",
        opens: "Record a change, on the Pay card of a person's page",
        saves: ["POST /team-members/:id/compensation"],
        schema: setCompensationSchema,
        fields: {
          grossAmount: "monthly gross from that date",
          effectiveFrom:
            "the day it starts; the previous figure ends the day before",
          changeReason: "why, like an annual increment",
        },
        onSave:
          "Records their pay from that date, split by the rule in Settings; the previous figure closes the day before, and one already starting that day is replaced. Salary sheets built for months from then on use it.",
        permission: "team.compensation.write",
      },
      {
        name: "<person> — social media",
        on: "/team/[id]",
        opens: "Add or Edit, on the Social media card of a person's page",
        saves: ["PUT /team-members/:id/socials"],
        schema: setTeamSocialsSchema,
        fields: {
          socials:
            "every account: platform and handle or address, one per platform",
        },
        onSave:
          "Replaces their list of accounts with this one, in this order; an account taken off the list is gone. It shows on the Social media card of their page.",
        permission: "team.write",
      },
      {
        name: "<person> — record an e-Return",
        on: "/team/[id]",
        opens: "Record a year, on the E-Return card of a person's page",
        saves: ["PUT /team-members/:id/ereturns"],
        schema: upsertEreturnSchema,
        fields: {
          fiscalYear: "first year of the income year: 2026 means 2026-2027",
          submittedOn: "the day it was filed; may be left blank",
        },
        onSave:
          "Records the person's return for that income year, or corrects the one already there: one per person per year. It lists on their E-Return card; the acknowledgement is added on their Documents card.",
        permission: "team.write",
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
