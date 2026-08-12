"use client";

import {
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  PSR_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { ArrowLeft, LoaderCircle, Lock, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Input, MoneyInput } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { teamApi, type CompensationDto, type TeamMemberDto } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { TeamMemberForm } from "./team-member-form";

export function TeamMemberScreen({
  member,
  compensation,
}: {
  member: TeamMemberDto;
  compensation: CompensationDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("team.write");
  const canSeePay = useCan("team.compensation.read");
  const canSetPay = useCan("team.compensation.write");

  const [tab, setTab] = useState<"details" | "pay">("details");
  const [editing, setEditing] = useState(false);
  const [settingPay, setSettingPay] = useState(false);

  const refresh = () => router.refresh();
  const currentPay = compensation.find((c) => c.effectiveTo === null) ?? compensation[0];

  return (
    <>
      <Link
        href="/team"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All team
      </Link>

      <PageHeader
        title={member.fullName}
        description={[
          member.employeeCode,
          member.designation,
          ENGAGEMENT_LABELS[member.engagementType],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canWrite ? (
            <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
              <SquarePen className="size-4" />
              Edit
            </Button>
          ) : null
        }
      />

      <div role="tablist" className="flex gap-1 border-b border-border">
        {(
          [
            ["details", "Details"],
            ["pay", "Compensation"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "details" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Employment" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Status">
                <Badge tone={member.status === "active" ? "positive" : "neutral"}>
                  {EMPLOYMENT_STATUS_LABELS[member.status]}
                </Badge>
              </Row>
              <Row label="Department">{member.department ?? "—"}</Row>
              <Row label="Joined" mono>
                {member.joinedOn}
              </Row>
              {member.endedOn ? (
                <Row label="Last day" mono>
                  {member.endedOn}
                </Row>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contact" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Phone" mono>
                {member.phone ?? "—"}
              </Row>
              <Row label="Work email">{member.workEmail ?? "—"}</Row>
              <Row label="Personal email">{member.personalEmail ?? "—"}</Row>
              <Row label="Address">{member.address ?? "—"}</Row>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tax"
              description="Missing PSR raises the withholding rate by half"
            />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="e-TIN" mono>
                {member.etin ?? "—"}
              </Row>
              <Row label="NID" mono>
                {member.nid ?? "—"}
              </Row>
              <Row label="Return filed">
                <Badge
                  tone={
                    member.psrStatus === "submitted"
                      ? "positive"
                      : member.psrStatus === "not_submitted"
                        ? "negative"
                        : "warning"
                  }
                >
                  {PSR_STATUS_LABELS[member.psrStatus]}
                </Badge>
              </Row>
              <Row label="Assessment year" mono>
                {member.psrAssessmentYear ?? "—"}
              </Row>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where they are paid" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Bank">{member.bankName ?? "—"}</Row>
              <Row label="Account" mono>
                {member.bankAccountNumber ?? "—"}
              </Row>
              <Row label="Routing" mono>
                {member.bankRouting ?? "—"}
              </Row>
              <Row label="Mobile wallet" mono>
                {member.walletNumber ?? "—"}
              </Row>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "pay" ? (
        !canSeePay ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
              <Lock className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Pay is not visible to you</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Your role manages people but not what they earn. The server
                refuses this independently — it is not simply hidden here.
              </p>
            </div>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Card className="flex-1 px-5 py-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Current gross, monthly
                </p>
                {currentPay ? (
                  <>
                    <Amount
                      value={currentPay.grossAmount}
                      className="mt-2 block text-2xl font-semibold"
                    />
                    <p className="num mt-1 text-xs text-muted-foreground">
                      Since {currentPay.effectiveFrom}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing recorded yet — they will be left off the salary
                    sheet until a figure exists.
                  </p>
                )}
              </Card>
              {canSetPay ? (
                <Button variant="primary" size="md" onClick={() => setSettingPay(true)}>
                  <Plus className="size-4" />
                  Record a change
                </Button>
              ) : null}
            </div>

            <Card>
              <CardHeader
                title="History"
                description="Every figure, and when it took effect"
              />
              <CardBody className="p-0">
                {compensation.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No pay recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-data min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-muted/50 text-left">
                          <th className="px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            From
                          </th>
                          <th className="px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Until
                          </th>
                          <th className="px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Why
                          </th>
                          <th className="px-5 py-2.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Gross
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {compensation.map((entry) => (
                          <tr key={entry.id} className="row-finance">
                            <td className="num px-5 py-2.5">
                              {entry.effectiveFrom}
                            </td>
                            <td className="num px-5 py-2.5 text-muted-foreground">
                              {entry.effectiveTo ?? "now"}
                            </td>
                            <td className="px-5 py-2.5 text-muted-foreground">
                              {entry.changeReason ?? "—"}
                            </td>
                            <td className="px-5 py-2.5">
                              <Amount
                                value={entry.grossAmount}
                                className="block font-medium"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        )
      ) : null}

      <TeamMemberForm
        open={editing}
        member={member}
        onClose={() => setEditing(false)}
        onSaved={refresh}
      />
      <CompensationForm
        open={settingPay}
        memberId={member.id}
        memberName={member.fullName}
        onClose={() => setSettingPay(false)}
        onSaved={refresh}
      />
    </>
  );
}

function Row({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("text-right", mono && "num")}>{children}</span>
    </div>
  );
}

function CompensationForm({
  open,
  memberId,
  memberName,
  onClose,
  onSaved,
}: {
  open: boolean;
  memberId: string;
  memberName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await teamApi.setCompensation(memberId, {
        grossAmount: String(data.get("grossAmount")),
        effectiveFrom: String(data.get("effectiveFrom")),
        changeReason: String(data.get("changeReason") ?? "") || undefined,
      });
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Set ${memberName}'s pay`}
      description="The previous figure is kept, closed off the day before this one starts."
    >
      <form id="pay-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Monthly gross" required error={fieldErrors.grossAmount}>
          <MoneyInput name="grossAmount" required placeholder="45000.00" />
        </Field>
        <Field
          label="From"
          required
          error={fieldErrors.effectiveFrom}
          hint="Payroll uses whichever figure applies to the month being run"
        >
          <DateInput name="effectiveFrom" required defaultValue={todayInDhaka()} />
        </Field>
        <Field label="Why" error={fieldErrors.changeReason}>
          <Input name="changeReason" placeholder="Annual increment" />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="pay-form" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}
