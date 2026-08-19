"use client";

import {
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  type Paginated,
} from "@finance/shared";
import { Eye, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataPanel } from "@/components/ui/patterns";
import { Segmented } from "@/components/ui/segmented";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { TeamMemberForm } from "./team-member-form";

export function TeamScreen({
  initialPage,
}: {
  initialPage: Paginated<TeamMemberDto>;
}) {
  const router = useRouter();
  const canWrite = useCan("team.write");
  const canSeePay = useCan("team.compensation.read");

  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh(q = query) {
    setPage(await teamApi.list({ q: q || undefined }));
    router.refresh();
  }

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
  }, [canSeePay, page]);

  const isCurrent = (m: TeamMemberDto) =>
    m.status === "active" || m.status === "on_leave";

  const current = page.items.filter(isCurrent);
  const past = page.items.filter((m) => !isCurrent(m));

  const shown = tab === "current" ? current : past;
  const employees = shown.filter((m) => m.engagementType === "employee");
  const contractors = shown.filter((m) => m.engagementType === "contractor");

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
        onSubmit={(next) => void refresh(next)}
        placeholder="Search by name, designation or phone"
        label="Search the team"
        className="max-w-sm"
      />

      {page.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Users className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">
              {query ? "Nobody matched that" : "No one added yet"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Add your employees and contractors here. Pay is recorded
              separately, once someone exists.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {/* Two views of one list, so a segmented group — the underline row
              is for pages that are different documents. */}
          <Segmented
            options={[
              {
                id: "current" as const,
                label: "Current team",
                count: current.length,
              },
              { id: "past" as const, label: "Past team", count: past.length },
            ]}
            value={tab}
            onChange={setTab}
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
            <>
              <Section
                title="Employees"
                subtitle={
                  tab === "past"
                    ? "No longer on the salary sheet"
                    : "Drawn on the monthly salary sheet"
                }
                members={employees}
                past={tab === "past"}
                showPay={canSeePay}
                salaries={salaries}
              />
              <Section
                title="Contractors"
                subtitle={
                  tab === "past"
                    ? "No longer billing"
                    : "Paid against bills — not on the salary sheet"
                }
                members={contractors}
                past={tab === "past"}
                showPay={canSeePay}
                salaries={salaries}
              />
            </>
          )}
        </>
      )}

      <TeamMemberForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => refresh()}
      />
    </>
  );
}

function Section({
  title,
  subtitle,
  members,
  past = false,
  showPay,
  salaries,
}: {
  /** Adds the last day, which is the fact the past tab is read for. */
  past?: boolean;
  /** The salary column appears only for a role that may read pay. */
  showPay: boolean;
  salaries: Map<string, string>;
  title: string;
  subtitle: string;
  members: TeamMemberDto[];
}) {
  if (members.length === 0) return null;

  return (
    <DataPanel
      title={`${title} · ${members.length}`}
      icon={title === "Contractors" ? "badge" : "groups"}
      description={subtitle}
    >
      <table className="table-data min-w-[860px] text-sm">
        <thead>
          <tr className="text-left">
            <Th>Name</Th>
            <Th className="w-40">Designation</Th>
            <Th className="w-32">Department</Th>
            <Th className="w-28">Date of Joining</Th>
            {past ? <Th className="w-28">Last day</Th> : null}
            {showPay ? (
              <Th className="w-36 text-right">Current salary</Th>
            ) : null}
            <Th className="w-28">Status</Th>
            <Th className="w-24 text-right" />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="row-finance">
              <td className="px-4 py-2.5">
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
                  className="font-medium hover:text-primary hover:underline"
                >
                  {member.fullName}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {ENGAGEMENT_LABELS[member.engagementType]}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {member.designation ?? "—"}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {member.department ?? "—"}
              </td>
              <td className="num px-4 py-2.5 text-muted-foreground">
                {member.joinedOn}
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
                <td className="num px-4 py-2.5 text-muted-foreground">
                  {member.endedOn ?? "—"}
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
                <td className="col-amount px-4 py-2.5">
                  {salaries.get(member.id) ? (
                    <Amount value={salaries.get(member.id)!} hideDecimals />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Not set
                    </span>
                  )}
                </td>
              ) : null}
              <td className="px-4 py-2.5">
                <Badge
                  tone={member.status === "active" ? "positive" : "neutral"}
                >
                  {EMPLOYMENT_STATUS_LABELS[member.status]}
                </Badge>
              </td>
              <td className="px-4 py-2.5 text-right">
                {/* A link, not a Button with a router push: <button> inside
                        <a> is invalid, so this borrows the secondary/sm look
                        and stays a real link — middle-click still opens it. */}
                <Link
                  href={`/team/${member.id}`}
                  prefetch={false}
                  className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition hover:bg-surface-muted"
                >
                  <Eye className="size-3.5" />
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataPanel>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}
