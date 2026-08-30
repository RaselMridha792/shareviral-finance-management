"use client";

import {
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  type Paginated,
} from "@finance/shared";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataPanel } from "@/components/ui/patterns";
import { Segmented } from "@/components/ui/segmented";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { SearchField } from "@/components/ui/search-field";
import { SerialCell, SerialHead, Th } from "@/components/ui/table";
import { serial } from "@/lib/pagination";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";
import { TeamMemberForm } from "./team-member-form";

export function TeamScreen({
  initialPage,
}: {
  initialPage: Paginated<TeamMemberDto>;
}) {
  const router = useRouter();
  const canWrite = useCan("team.write");
  const del = useRowDelete<TeamMemberDto>({
    kind: "team-member",
    subject: "team member",
    describe: (member) => (
      <div className="flex flex-col">
        <span className="font-medium">{member.fullName}</span>
        <span className="text-xs text-muted-foreground">
          {member.designation ?? member.engagementType} · joined{" "}
          {member.joinedOn}
        </span>
      </div>
    ),
    consequences: (
      <p>
        Their profile, salary history and paid-tool seats go with them. If they
        have simply left,{" "}
        <span className="font-medium text-foreground">
          change their status to ended
        </span>{" "}
        instead — that keeps the payslips and the tax record their leaving does
        not undo. Anyone with money recorded against them cannot be deleted at
        all, and the app will say so.
      </p>
    ),
    onDone: () => void reload(),
  });
  const canSeePay = useCan("team.compensation.read");

  /**
   * The fetched page, and which page it is.
   *
   * `page` used to hold the envelope itself, back when the client asked for
   * one page of a hundred and there was never a second one to name. The
   * number now has to exist separately, because it is what goes to the API
   * and what the SL column counts from.
   */
  const [data, setData] = useState(initialPage);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  /**
   * The term the fetched rows were actually fetched for.
   *
   * `query` is what is in the box, which changes on every keystroke; this is
   * what was pressed Search on. Keeping them apart is what lets the fetch
   * effect depend on the search without firing a request per letter typed.
   */
  const [submitted, setSubmitted] = useState("");
  const [creating, setCreating] = useState(false);
  /**
   * The person the edit drawer is open against; null is closed. It is the
   * same drawer the Add button opens, handed a member so it saves an update
   * instead of creating somebody new.
   */
  const [editing, setEditing] = useState<TeamMemberDto | null>(null);

  /**
   * Re-read the page being looked at, after somebody was added or edited.
   *
   * Stays on the current page and keeps the current search: a save is not a
   * reason to be sent back to the top of the list.
   */
  async function reload() {
    setData(await teamApi.list({ page, q: submitted || undefined }));
    router.refresh();
  }

  /**
   * Fetch whenever the page or the search changes.
   *
   * The first render is skipped — the server component already handed us page
   * 1 of the unfiltered list as `initialPage`, and refetching it on mount
   * would be the same twenty rows over again.
   */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    let alive = true;
    void teamApi
      .list({ page, q: submitted || undefined })
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [page, submitted]);

  /**
   * Status deliberately has no drawer of its own here.
   *
   * The control lives on the profile, where it sits beside the last-day field
   * and the history it changes, and where the wording explains that nothing is
   * deleted. Taking somebody off the salary sheet is the one change on this
   * screen with consequences, so the button goes to the page that says so
   * rather than growing a second, thinner copy of that form on the list.
   */
  const goToProfile = (member: TeamMemberDto) =>
    router.push(`/team/${member.id}`);

  /**
   * Two tabs, and the names matter.
   *
   * "Ex-employee" files a person under what they stopped being. These are
   * people whose work is in the audit trail, whose payslips are still issued
   * against them, and who may well come back — the same list a reference
   * request is answered from. Current and Past say when somebody was here
   * without saying anything about why they left, which the app does not know
   * and has no business implying.
   *
   * On leave counts as current. Somebody on leave has not left.
   */
  const [tab, setTab] = useState<"current" | "past">("current");

  /**
   * Switching tab goes back to page 1.
   *
   * The two tabs are two different lengths, so page 4 of Current is very
   * often past the end of Past — and an empty table on arrival reads as
   * "nobody has ever left" rather than as "you are too far down".
   */
  const changeTab = (next: "current" | "past") => {
    setTab(next);
    setPage(1);
  };

  /**
   * What each person earns now, fetched only when the role may see it.
   *
   * Empty for a role without the permission, and the column is then not
   * rendered at all — rather than rendered full of dashes, which reads as
   * "nobody is paid" instead of "this is not yours to see".
   */
  const [salaries, setSalaries] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!canSeePay) return;
    let alive = true;
    void teamApi
      .currentSalaries()
      .then((rows) => {
        if (alive) {
          setSalaries(
            new Map(rows.map((r) => [r.teamMemberId, r.grossAmount])),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canSeePay, data]);

  const isCurrent = (m: TeamMemberDto) =>
    m.status === "active" || m.status === "on_leave";

  /**
   * Current / Past is split here, out of the twenty rows this page happens to
   * hold — which is why it carries no count. See the note on the Segmented
   * group below.
   */
  const current = data.items.filter(isCurrent);
  const past = data.items.filter((m) => !isCurrent(m));

  /**
   * One list, not two.
   *
   * There were two panels here — Employees and Contractors — cut from this
   * page by `engagementType`. They are gone, and the fact they carried is the
   * Employment type column instead: every contractor reads Contractual, which
   * is the same fact in the place somebody scanning a directory is already
   * looking. Two panels for one page of twenty rows also meant the second one
   * appeared and vanished depending on whether that page happened to contain a
   * contractor, which reads as the company having hired and fired one between
   * page one and page two.
   */
  const shown = tab === "current" ? current : past;

  return (
    <>
      <PageHeader
        title="Team"
        icon="groups"
        description="Everyone on the payroll, and everyone who bills."
        actions={
          <>
            {canWrite ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setCreating(true)}
              >
                <Plus className="size-4" />
                Add person
              </Button>
            ) : null}
          </>
        }
      />

      {!canSeePay ? (
        // This used to say "your role cannot see what they are paid", full
        // stop — written before joining salary was deliberately made visible
        // here. With that column beside it the sentence was simply untrue, and
        // a promise about pay that the same screen breaks is worse than no
        // promise. It now says which figure this is and which one it is not.
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
          Joining Salary is what was agreed at hire — part of the employment
          record your role keeps. What anybody earns now, and every change
          since, is held separately behind its own permission.
        </p>
      ) : null}

      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={(next) => {
          // Back to page 1: a narrower result set is a shorter one, and
          // staying on page 4 of it lands on rows that no longer exist.
          setSubmitted(next);
          setPage(1);
        }}
        placeholder="Search by name, designation or phone"
        label="Search the team"
        className="max-w-sm"
      />

      {data.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Users className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">
              {/* `submitted`, not `query`: the box can hold half a typed name
                  that was never searched for, and "Nobody matched that" under
                  the full list would be blaming a search nobody ran. */}
              {submitted ? "Nobody matched that" : "No one added yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add your employees and contractors here. Pay is recorded
              separately, once someone exists.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/*
              Two views of one list, so a segmented group — the underline row
              is for pages that are different documents.

              The counts that used to sit on these two chips are gone, and
              deliberately. They were `current.length` and `past.length`,
              counted over the rows this page happens to hold: with the whole
              team fetched at once they were the real totals, and the moment a
              page holds twenty they became "how many of these twenty", under
              a label that reads as "how many people". A chip saying
              "Past team 3" beside a company that has lost forty is a wrong
              number on a screen somebody answers questions from.

              They cannot be worked out here. Current is active *or* on leave
              and Past is resigned *or* terminated, while the API's `status`
              filter takes exactly one status — so neither tab is a query this
              client can ask, and no whole-set count for either arrives in the
              envelope. `data.total` counts everybody, which is what the pager
              below says and all this screen honestly knows. Restoring the
              numbers needs the API, not this file: see the report.
          */}
          <Segmented
            options={[
              { id: "current" as const, label: "Current team" },
              { id: "past" as const, label: "Past team" },
            ]}
            value={tab}
            onChange={changeTab}
            label="Team"
          />

          {shown.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
                <Users className="size-6" />
              </span>
              <p className="max-w-sm text-sm text-muted-foreground">
                {tab === "past"
                  ? "Nobody has left yet. When somebody resigns or is let go, change their status on their profile and they move here — their record and their payslips stay."
                  : "Nobody is currently working. Anybody who has left is under Past team."}
              </p>
            </Card>
          ) : (
            /*
              The heading names the rows, not the tab.

              The obvious title here is the tab's own name — and it would then
              sit a few pixels under a selected tab already saying it, which
              is a heading whose whole content is on screen twice. What the
              rows have in common is the thing that actually changed: the
              employees and the contractors are one list now. The description
              is what varies with the tab, because that is what varies.
            */
            <Section
              title="Employees and contractors"
              subtitle={
                tab === "past"
                  ? "No longer on the salary sheet, and no longer billing"
                  : "Everyone drawing a salary or billing right now"
              }
              members={shown}
              page={page}
              past={tab === "past"}
              showPay={canSeePay}
              salaries={salaries}
              onEdit={canWrite ? setEditing : undefined}
              onStatus={canWrite ? goToProfile : undefined}
              onDelete={canWrite ? del.ask : undefined}
            />
          )}
        </>
      )}

      {/*
          One pager for the screen, outside the empty branch above.

          Outside, because the empty card replaces both tables — and a pager
          written inside it vanishes on exactly the page somebody needs it on:
          the one that came up blank, with Previous the only way back.

          One, because there is one request behind all of this. The tab cuts a
          single fetched page in two, and neither half is a page of its own, so
          neither gets its own control. What this pages is the team.
      */}
      <Pagination
        page={page}
        totalPages={data.totalPages}
        total={data.total}
        noun="person"
        nounPlural="people"
        onPage={setPage}
      />

      <TeamMemberForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => reload()}
      />

      {/* Keyed on the id because every field in there is uncontrolled: without
          it, opening a second person after a first would keep the first
          person's defaults. */}
      {editing ? (
        <TeamMemberForm
          key={editing.id}
          open
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => reload()}
        />
      ) : null}
      {del.dialog}
    </>
  );
}

function Section({
  title,
  subtitle,
  members,
  page,
  past = false,
  showPay,
  salaries,
  onEdit,
  onStatus,
  onDelete,
}: {
  /** Which page these rows came from — the SL column counts from it. */
  page: number;
  /** Adds the last day, which is the fact the past tab is read for. */
  past?: boolean;
  /** The salary column appears only for a role that may read pay. */
  showPay: boolean;
  salaries: Map<string, string>;
  title: string;
  subtitle: string;
  members: TeamMemberDto[];
  /**
   * Left undefined for a role that cannot write, which renders the pair
   * disabled rather than dropping it. A blank cell where every other row has
   * two buttons reads as a broken table, not as "this is not yours to do".
   */
  onEdit?: (member: TeamMemberDto) => void;
  onStatus?: (member: TeamMemberDto) => void;
  onDelete?: (member: TeamMemberDto) => void;
}) {
  if (members.length === 0) return null;

  return (
    /*
     * The heading was `${title} · ${members.length}` — "Employees · 18".
     *
     * That number counted the employees among the rows this page holds, not
     * the employees. Once a page is twenty people it says 12 on page one and
     * 8 on page two about a company whose payroll has not changed, and the
     * split was made here rather than asked for, so the whole set never sent a
     * figure that could replace it. A heading that names a quantity has to be
     * right about it; this one now names the group. The honest total is on the
     * pager below, which is the one figure this screen fetches.
     */
    <DataPanel title={title} icon="groups" description={subtitle}>
      {/* 960 before Employment type. The fixed columns alone now come to
          roughly a thousand pixels, and a min-width under them lets the
          browser squeeze Designation instead of scrolling — which wraps
          "Business Development Executive" onto three lines. The panel's own
          overflow-x-auto keeps the scroll inside the card, off the page. */}
      <table className="table-data min-w-[1080px] text-sm">
        <thead>
          <tr className="text-left">
            {/*
              SL is anchored to the page, not restarted inside the section.

              It was `index + 1`, from when one fetch held everybody: both
              tables started at 1, which said what it meant — Employees and
              Contractors are two lists that sit under one heading, not one
              list, and the salary sheet treats them as anything but. With
              twenty rows to a page that same `index + 1` starts over on page
              two, so the twenty-first employee is also "1" and two rows in
              one table answer to the same number. `serial` counts from the
              page instead, which is the one thing here that cannot collide.

              It does leave gaps — employees 1–12 on page one, then 21–25 on
              page two — because the section is cut out of the page rather
              than fetched as itself. A gap is honest about that; a repeat
              would not be.
            */}
            <SerialHead />
            {/* The company's own identifier, beside the serial the app made
                up. Most people have none, and the column says so rather than
                sitting blank. */}
            <Th width="w-28">Employee ID</Th>
            <Th width="w-28">Date of Joining</Th>
            <Th>Name</Th>
            {past ? <Th width="w-28">Last day</Th> : null}
            {showPay ? (
              <Th width="w-36" align="right">
                Current salary
              </Th>
            ) : null}
            <Th width="w-40">Designation</Th>
            {/*
              Where and on what footing somebody works, next to what they do.

              It sits after Designation because the two are read together —
              "Motion Designer, Remote" is one answer to one question, and the
              department is a different one. It also carries what the removed
              Contractors panel used to: a contractor reads Contractual here.

              Not a badge. Every row has a value, so twenty tinted pills down
              one column would be the loudest thing on a screen whose subject
              is the people, and a badge on every row distinguishes nobody.
            */}
            <Th width="w-32">Employment type</Th>
            <Th width="w-32">Department</Th>
            <Th width="w-28">Status</Th>
            {/*
              Last, after every data column, because the pair sits in the same
              place on every table in the app. This screen had no controls at
              all: the View column went when the name itself became the link
              to the profile, and nothing took its place — so editing somebody
              meant opening their page first.
            */}
            <RowActionsHead deletable={Boolean(onDelete)} />
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => (
            <tr key={member.id} className="row-finance">
              <SerialCell n={serial(page, index)} />
              <td className="num text-muted-foreground">
                {member.employeeCode ?? "N/A"}
              </td>
              <td className="num text-muted-foreground">{member.joinedOn}</td>
              <td>
                {/*
                      prefetch={false} on every link that repeats per row.

                      Next prefetches each link as it enters the viewport, so
                      this table asked the server for one route per person —
                      eighteen requests to open, at most, one page. Measured on
                      the deployed site: a page view of /team fired 33 prefetch
                      requests, and the team is the list that grows.

                      Each one is only ~330 bytes of routing information and
                      never touches the API, so this is not a bug being fixed;
                      it is work not worth doing. The sidebar keeps its
                      prefetch, because there the guess is usually right.
                    */}
                <Link
                  href={`/team/${member.id}`}
                  prefetch={false}
                  className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                >
                  {member.fullName}
                </Link>
                {/* No "Employee" or "Contractor" under the name. This table
                    does now mix the two — the second panel is gone — but the
                    Employment type column says Contractual on exactly the rows
                    such a label would have appeared on, and a fact printed
                    twice on one row is a row that is harder to read, not a row
                    that says more. */}
              </td>
              {/*
                    Must appear under exactly the same condition as its header.
                    It did not, for one deploy: the header was added and this
                    was not, so every row in the past tab was one cell short
                    and each value sat under the heading to its left — the
                    status badge under Joining Salary, and the button under
                    Status. A row that is silently offset reads as wrong data
                    rather than as a broken table.
                  */}
              {past ? (
                <td className="num text-muted-foreground">
                  {member.endedOn ?? "N/A"}
                </td>
              ) : null}
              {/*
                    What they earn now, not what they were hired at.

                    The joining figure was here first and is the wrong one to
                    scan a directory with: it is fixed on the day somebody
                    started and says nothing about today. It is still on the
                    profile, where it is labelled as what it is.

                    "Not set" is deliberate wording. Somebody with no
                    compensation record is not on ৳0 — they are the person the
                    salary sheet will silently skip, and this is where that
                    shows up before payroll day rather than on it.
                  */}
              {showPay ? (
                <td className="col-amount">
                  {salaries.get(member.id) ? (
                    <Amount value={salaries.get(member.id)!} hideDecimals />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Not set
                    </span>
                  )}
                </td>
              ) : null}
              <td className="text-muted-foreground">
                {member.designation ?? "N/A"}
              </td>
              {/*
                    An em dash, not "Onsite".

                    The column is new and only contractors were given a value
                    when it was added — because a contractor is engaged
                    contractually, which is a fact and not a guess. Nobody has
                    been asked where anyone else works, and filling the gap
                    with the commonest answer would put a hundred and twenty
                    unverified claims on a screen people answer questions from.
                    The dash says "not recorded", which is true.
                  */}
              <td className="text-muted-foreground">
                {member.employmentType
                  ? EMPLOYMENT_TYPE_LABELS[member.employmentType]
                  : "N/A"}
              </td>
              <td className="text-muted-foreground">
                {member.department ?? "N/A"}
              </td>
              <td>
                <Badge
                  tone={member.status === "active" ? "positive" : "neutral"}
                >
                  {EMPLOYMENT_STATUS_LABELS[member.status]}
                </Badge>
              </td>
              <RowActions
                onEdit={onEdit ? () => onEdit(member) : undefined}
                second="status"
                onSecond={onStatus ? () => onStatus(member) : undefined}
                onDelete={onDelete ? () => onDelete(member) : undefined}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}
