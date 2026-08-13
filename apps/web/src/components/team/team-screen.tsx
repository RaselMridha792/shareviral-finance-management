"use client";

import {
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  type Paginated,
} from "@finance/shared";
import { Download, Eye, Plus, Search, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { controlClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { exportUrl } from "@/lib/ledger";
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
  // Each read unconditionally: `exports.run` says this role may download
  // things, `team.read` says it may see this.
  const canRunExports = useCan("exports.run");
  const canReadTeam = useCan("team.read");
  const canExport = canRunExports && canReadTeam;

  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  // What the table is actually filtered by. The search box can hold text that
  // has not been submitted yet, and the download has to match the rows on
  // screen rather than the typing.
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh(q = query) {
    setPage(await teamApi.list({ q: q || undefined }));
    setApplied(q);
    router.refresh();
  }

  const employees = page.items.filter((m) => m.engagementType === "employee");
  const contractors = page.items.filter(
    (m) => m.engagementType === "contractor",
  );

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone on the payroll, and everyone who bills."
        actions={
          <>
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  // The directory only. Pay is not in this DTO, so it cannot
                  // be in this file.
                  window.location.href = exportUrl("team-members", {
                    q: applied || undefined,
                  });
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
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
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
          Your role can manage people but not see what they are paid. Pay lives
          on a separate screen behind its own permission.
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
        className="relative flex max-w-sm items-center"
      >
        <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <label className="sr-only" htmlFor="team-search">
          Search the team
        </label>
        <input
          id="team-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, code, or designation"
          className={cn(controlClass, "pl-9")}
        />
      </form>

      {page.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Users className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">
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
          <Section
            title="Employees"
            subtitle="Drawn on the monthly salary sheet"
            members={employees}
          />
          <Section
            title="Contractors"
            subtitle="Paid against bills — not on the salary sheet"
            members={contractors}
          />
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
}: {
  title: string;
  subtitle: string;
  members: TeamMemberDto[];
}) {
  if (members.length === 0) return null;

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title} · <span className="num">{members.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-data min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <Th className="w-24">Code</Th>
                <Th>Name</Th>
                <Th className="w-40">Designation</Th>
                <Th className="w-32">Department</Th>
                <Th className="w-28">Date of Joining</Th>
                <Th className="w-36 text-right">Joining Salary</Th>
                <Th className="w-28">Status</Th>
                <Th className="w-24 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((member) => (
                <tr
                  key={member.id}
                  className="row-finance hover:bg-surface-muted/50"
                >
                  <td className="num px-4 py-2.5 text-muted-foreground">
                    {member.employeeCode}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/team/${member.id}`}
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
                  {/* Replaced the PSR badge. Whether somebody filed a return
                      is a withholding question and it is answered on the TDS
                      screen; on a staff list it took a column and told a
                      reader nothing they came here for. What was agreed at
                      hire does belong here. */}
                  <td className="col-amount px-4 py-2.5">
                    {member.joiningSalary ? (
                      <Amount value={member.joiningSalary} hideDecimals />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
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
        </div>
      </Card>
    </div>
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
