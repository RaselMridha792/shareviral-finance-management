"use client";

import {
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  GENDER_LABELS,
  PAYROLL_STATUS_LABELS,
  PSR_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  LoaderCircle,
  Lock,
  Plus,
  Printer,
  SquarePen,
} from "lucide-react";
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
import { ApiError } from "@/lib/api-client";
import {
  teamApi,
  type CompensationDto,
  type MemberPayslipDto,
  type TeamMemberDto,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { TeamMemberForm } from "./team-member-form";

const TABS = [
  ["personal", "Personal"],
  ["contact", "Contact"],
  ["employment", "Employment"],
  ["tax", "Tax & bank"],
  ["pay", "Pay"],
] as const;

type Tab = (typeof TABS)[number][0];

export function TeamMemberScreen({
  member,
  compensation,
  payslips,
}: {
  member: TeamMemberDto;
  compensation: CompensationDto[];
  /**
   * Empty both when there are none and when the role cannot read payroll —
   * which is safe here only because the whole Pay tab is already behind the
   * compensation gate. Never render this outside it.
   */
  payslips: MemberPayslipDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("team.write");
  const canSeePay = useCan("team.compensation.read");
  const canSetPay = useCan("team.compensation.write");

  const [tab, setTab] = useState<Tab>("personal");
  const [editing, setEditing] = useState(false);
  const [settingPay, setSettingPay] = useState(false);

  const refresh = () => router.refresh();
  const currentPay = compensation.find((c) => c.effectiveTo === null) ?? compensation[0];
  // The sheet has an Age column. Storing it would be storing something that is
  // wrong by the next birthday, so it is counted from the date of birth.
  const age = member.dateOfBirth ? ageInYears(member.dateOfBirth) : null;

  return (
    <>
      <Link
        href="/team"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All team
      </Link>

      <Card className="flex flex-wrap items-center gap-4 p-5">
        <MemberPhoto
          // Resets the broken-image state when the link itself changes.
          key={member.photoUrl ?? "none"}
          fullName={member.fullName}
          photoUrl={member.photoUrl}
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {member.fullName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[member.designation, member.department].filter(Boolean).join(" · ") ||
              ENGAGEMENT_LABELS[member.engagementType]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="num text-xs text-muted-foreground">
              {member.employeeCode}
            </span>
            <Badge tone={member.status === "active" ? "positive" : "neutral"}>
              {EMPLOYMENT_STATUS_LABELS[member.status]}
            </Badge>
          </div>
        </div>

        {canWrite ? (
          <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
            <SquarePen className="size-4" />
            Edit
          </Button>
        ) : null}
      </Card>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(([id, label]) => (
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

      {tab === "personal" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Personal" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row
                label="Gender"
                value={member.gender ? GENDER_LABELS[member.gender] : null}
              />
              <Row label="Blood group" value={member.bloodGroup} />
              <Row label="Date of birth">
                {member.dateOfBirth ? (
                  <>
                    <span className="num">{member.dateOfBirth}</span>
                    {age !== null ? (
                      <span className="ml-2 text-muted-foreground">
                        <span className="num">{age}</span> yrs
                      </span>
                    ) : null}
                  </>
                ) : null}
              </Row>
              <Row label="NID" mono value={member.nid} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              description="Whatever the sheet's last column carried"
            />
            <CardBody className="text-sm">
              {member.notes ? (
                <p className="whitespace-pre-line">{member.notes}</p>
              ) : (
                <p className="text-muted-foreground">Nothing noted.</p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "contact" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Phone" mono value={member.phone} />
              <Row label="Email" value={member.personalEmail} />
              <Row label="Work email" value={member.workEmail} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Addresses" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Present" value={member.address} />
              <Row label="Permanent" value={member.permanentAddress} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "employment" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Employment"
              description="The salary agreed at hire — what they are paid now is on the Pay tab"
            />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Code" mono value={member.employeeCode} />
              <Row
                label="Engaged as"
                value={ENGAGEMENT_LABELS[member.engagementType]}
              />
              <Row label="Department" value={member.department} />
              <Row label="Designation" value={member.designation} />
              <Row label="Joined" mono value={member.joinedOn} />
              <Row label="Joining salary">
                {member.joiningSalary ? (
                  <Amount value={member.joiningSalary} className="font-medium" />
                ) : null}
              </Row>
              <Row label="Status">
                <Badge tone={member.status === "active" ? "positive" : "neutral"}>
                  {EMPLOYMENT_STATUS_LABELS[member.status]}
                </Badge>
              </Row>
              <Row label="Last day" mono value={member.endedOn} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Education" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row
                label="Level"
                value={
                  member.educationLevel
                    ? EDUCATION_LEVEL_LABELS[member.educationLevel]
                    : null
                }
              />
              <Row label="Major" value={member.educationMajor} />
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Documents"
              description="Links, not uploads — this app keeps no files of its own"
            />
            <CardBody className="flex flex-wrap gap-2">
              <DocumentLink href={member.cvUrl} label="CV" />
              <DocumentLink
                href={member.appointmentLetterUrl}
                label="Appointment letter"
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "tax" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Tax"
              description="Missing PSR raises the withholding rate by half"
            />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="e-TIN" mono value={member.etin} />
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
              <Row label="Assessment year" mono value={member.psrAssessmentYear} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Where they are paid" />
            <CardBody className="flex flex-col gap-2.5 text-sm">
              <Row label="Bank" value={member.bankName} />
              <Row label="Account" mono value={member.bankAccountNumber} />
              <Row label="Routing" mono value={member.bankRouting} />
              <Row label="Wallet" value={member.walletProvider} />
              <Row label="Wallet number" mono value={member.walletNumber} />
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
                          <Th>From</Th>
                          <Th>Until</Th>
                          <Th>Why</Th>
                          <Th className="text-right">Gross</Th>
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

            <Card>
              <CardHeader
                title="Payslips"
                description="Every month they appear on a finalised salary sheet"
              />
              <CardBody className="p-0">
                {payslips.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted-foreground">
                    No payslips yet — one appears here for each month whose
                    salary sheet has been finalised.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-data min-w-[620px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-surface-muted/50 text-left">
                          <Th>Month</Th>
                          <Th>Salary sheet</Th>
                          <Th className="text-right">Gross</Th>
                          <Th className="text-right">Tax</Th>
                          <Th className="text-right">Net</Th>
                          <Th className="w-24" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {payslips.map((slip) => (
                          <tr key={slip.id} className="row-finance">
                            <td className="px-5 py-2.5">
                              <span className="font-medium">
                                {slip.runLabel}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {slip.paidOn ? (
                                  <>
                                    Paid{" "}
                                    <span className="num">{slip.paidOn}</span>
                                  </>
                                ) : (
                                  "Not paid yet"
                                )}
                              </span>
                            </td>
                            <td className="px-5 py-2.5">
                              <Badge
                                tone={
                                  slip.runStatus === "paid"
                                    ? "positive"
                                    : slip.runStatus === "finalized"
                                      ? "primary"
                                      : "neutral"
                                }
                              >
                                {PAYROLL_STATUS_LABELS[slip.runStatus]}
                              </Badge>
                            </td>
                            <td className="px-5 py-2.5">
                              <Amount
                                value={slip.grossAmount}
                                tone="neutral"
                                className="block"
                              />
                            </td>
                            <td className="px-5 py-2.5">
                              <Amount
                                value={slip.tdsAmount}
                                tone="neutral"
                                className="block"
                              />
                            </td>
                            <td className="px-5 py-2.5">
                              <Amount
                                value={slip.netAmount}
                                tone="neutral"
                                className="block font-medium"
                              />
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              {/*
                                The route's segment is named runId but carries
                                the payroll line id — one payslip is one line.
                              */}
                              <Link
                                href={`/payroll/${slip.id}/payslip`}
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <Printer className="size-3" />
                                Payslip
                              </Link>
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

/**
 * The photo is a link somebody pasted — a Drive file that may be moved, made
 * private, or deleted long after it was saved. A dead link must degrade to the
 * initials the rest of the app already shows, not to a browser's broken-image
 * icon on somebody's face.
 */
function MemberPhoto({
  fullName,
  photoUrl,
}: {
  fullName: string;
  photoUrl: string | null;
}) {
  const [broken, setBroken] = useState(false);

  if (!photoUrl || broken) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/12 text-lg font-semibold text-primary">
        {initialsOf(fullName)}
      </span>
    );
  }

  return (
    // Not next/image: the host is whatever the pasted link points at, and
    // remote hosts have to be declared up front for the optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photoUrl}
      alt={fullName}
      loading="lazy"
      onError={() => setBroken(true)}
      className="size-16 shrink-0 rounded-xl border border-border object-cover"
    />
  );
}

/**
 * A paper somebody pasted a link to.
 *
 * Named by what it is, never by its address — a Drive URL is eighty characters
 * of noise that tells nobody what it opens. Absent is stated rather than left
 * blank: "no signed letter on file" is itself something HR needs to see.
 */
function DocumentLink({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm">
        <FileText className="size-4 text-muted-foreground" />
        {label}
        <span className="text-muted-foreground">Not on file</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:border-primary hover:text-primary"
    >
      <FileText className="size-4 text-muted-foreground" />
      {label}
      <ExternalLink className="size-3.5 text-muted-foreground" />
    </a>
  );
}

/** Only letters: a name like "HR (test)" must not render as "H(". */
function initialsOf(fullName: string): string {
  return (
    fullName
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}]/gu, ""))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

/** Whole years, counted against today in Dhaka. */
function ageInYears(dateOfBirth: string): number | null {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const [thisYear, thisMonth, thisDay] = todayInDhaka().split("-").map(Number);
  if (!year || !month || !day) return null;

  let age = thisYear - year;
  if (thisMonth < month || (thisMonth === month && thisDay < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * A column heading, defined once so the two tables on the Pay tab cannot drift
 * apart — they sit one above the other, where any difference is obvious.
 */
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
        "px-5 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * One line of a profile. A field nobody has filled in still gets its label and
 * a muted dash — a label with nothing after it reads as a rendering fault.
 */
function Row({
  label,
  value,
  children,
  mono = false,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  const content = children ?? value;
  const empty = content === null || content === undefined || content === "";

  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right wrap-break-word",
          mono && "num",
          empty && "text-muted-foreground",
        )}
      >
        {empty ? "—" : content}
      </span>
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
