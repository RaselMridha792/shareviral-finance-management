"use client";

import {
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  ENGAGEMENT_LABELS,
  GENDER_LABELS,
  PAYROLL_STATUS_LABELS,
  PSR_STATUS_LABELS,
  todayInDhaka,
  type EmploymentStatus,
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
  UserCog,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useNameThisPage } from "@/components/layout/breadcrumb";
import { useCan } from "@/components/auth/session-provider";
import { DocumentSlots } from "@/components/files/document-slots";
import { PhotoUpload } from "@/components/files/file-manager";
import { ImageLightbox } from "@/components/ui/overlay";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/components/settings-provider";
import { MemberTools } from "@/components/team/member-tools";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
} from "@/components/ui/field";
import { ApiError, fileHref } from "@/lib/api-client";
import {
  teamApi,
  type CompensationDto,
  type MemberPayslipDto,
  type TeamMemberDto,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";
import { TeamMemberForm } from "./team-member-form";

/**
 * One person, on one page.
 *
 * This was five tabs — Personal, Contact, Employment, Tax & bank, Pay — and
 * every one of them held four or five lines. Splitting nineteen facts across
 * five clicks means anybody answering a question about somebody has to
 * remember which tab it lives on, and printing or reading the whole record was
 * impossible. It is one scroll now.
 *
 * The labels are the company's own sheet, word for word, so a row here and a
 * column there are recognisably the same field. Two liberties: the trailing
 * colons that some headings carry ("Blood Group:") are dropped, and so is the
 * "(MM/DD/YYYY)" in the joining-date heading — dates are shown in full here,
 * unambiguously, rather than in a format that reads differently in Dhaka than
 * it does in New York.
 */
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
  // The rail knows the ancestors; only this page knows the record.
  useNameThisPage(member.fullName);

  const settings = useSettings();
  const router = useRouter();
  const canWrite = useCan("team.write");
  const canSeePay = useCan("team.compensation.read");
  const canSetPay = useCan("team.compensation.write");

  const [editing, setEditing] = useState(false);
  const [settingPay, setSettingPay] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const refresh = () => router.refresh();

  /**
   * Still here.
   *
   * `on_leave` counts: somebody on leave has not left, and a last day against
   * them would be wrong rather than merely empty.
   */
  const working = member.status === "active" || member.status === "on_leave";

  const [viewingPhoto, setViewingPhoto] = useState(false);
  const photoSrc = member.photoFileId
    ? fileHref(member.photoFileId)
    : member.photoUrl;
  const currentPay =
    compensation.find((c) => c.effectiveTo === null) ?? compensation[0];
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
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => photoSrc && setViewingPhoto(true)}
            className={cn(
              "rounded-xl",
              photoSrc ? "cursor-zoom-in" : "cursor-default",
            )}
            aria-label={
              photoSrc ? `View ${member.fullName}'s photo` : undefined
            }
          >
            <MemberPhoto
              // Resets the broken-image state when the picture itself changes,
              // including the moment a new one finishes uploading.
              key={member.photoFileId ?? member.photoUrl ?? "none"}
              fullName={member.fullName}
              src={photoSrc}
            />
          </button>
          {canWrite ? (
            <PhotoUpload memberId={member.id} onUploaded={refresh} />
          ) : null}
        </div>

        <ImageLightbox
          open={viewingPhoto}
          src={photoSrc}
          alt={member.fullName}
          onClose={() => setViewingPhoto(false)}
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {member.fullName}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[member.designation, member.department]
              .filter(Boolean)
              .join(" · ") || ENGAGEMENT_LABELS[member.engagementType]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={member.status === "active" ? "positive" : "neutral"}>
              {EMPLOYMENT_STATUS_LABELS[member.status]}
            </Badge>
          </div>
        </div>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Separate from Edit on purpose. Somebody resigning is not the
                same kind of act as correcting a phone number: it is the one
                change that takes a person off the salary sheet, and it should
                be reachable in one click and read as a decision. */}
            <Button
              variant="secondary"
              size="md"
              onClick={() => setChangingStatus(true)}
            >
              <UserCog className="size-4" />
              Change status
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setEditing(true)}
            >
              <SquarePen className="size-4" />
              Edit
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Everything the sheet carries, in the sheet's own order and its own
          words, so a row here and a column there are the same field. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Employee details" />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            <Row label="Name of Employee" value={member.fullName} />
            <Row label="Designation" value={member.designation} />
            <Row label="Age">
              {age !== null ? (
                <>
                  <span className="num">{age}</span> yrs
                </>
              ) : null}
            </Row>
            <Row
              label="Gender"
              value={member.gender ? GENDER_LABELS[member.gender] : null}
            />
            <Row label="Blood Group" value={member.bloodGroup} />
            <Row label="Date Of Birth" mono value={member.dateOfBirth} />
            <Row label="NID Number" mono value={member.nid} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact" />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            <Row label="Contact No." mono value={member.phone} />
            <Row label="Email" value={member.personalEmail} />
            <Row label="Work email" value={member.workEmail} />
            <Row label="Present Address" value={member.address} />
            <Row label="Permanent Address" value={member.permanentAddress} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Employment"
            description="Joining Salary is what was agreed at hire — what they are paid now is below"
          />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            <Row label="Date of Joining" mono value={member.joinedOn} />
            <Row label="Joining Salary">
              {member.joiningSalary ? (
                <Amount value={member.joiningSalary} className="font-medium" />
              ) : null}
            </Row>
            <Row
              label="Education Level"
              value={
                member.educationLevel
                  ? EDUCATION_LEVEL_LABELS[member.educationLevel]
                  : null
              }
            />
            <Row label="Education Major" value={member.educationMajor} />
          </CardBody>
        </Card>

        {/* Not on the sheet. These are the app's own — the code it files
            people under, and the status the salary sheet reads. */}
        <Card>
          <CardHeader title="Record" />
          <CardBody className="flex flex-col gap-2.5 text-sm">
            <Row
              label="Engaged as"
              value={ENGAGEMENT_LABELS[member.engagementType]}
            />
            <Row label="Department" value={member.department} />
            <Row label="Status">
              <Badge tone={member.status === "active" ? "positive" : "neutral"}>
                {EMPLOYMENT_STATUS_LABELS[member.status]}
              </Badge>
            </Row>
            {/*
              Only for somebody who has one.

              A row reading "Last day —" against a person who is working says
              nothing, and reads as a gap in the record rather than as the
              absence of an event. It appears the moment a status is set that
              implies leaving, which is also the moment the form asks for the
              date.
            */}
            {member.endedOn || !working ? (
              <Row label="Last day" mono value={member.endedOn} />
            ) : null}
          </CardBody>
        </Card>

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
            <Row
              label="Assessment year"
              mono
              value={member.psrAssessmentYear}
            />
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

        <Card className="lg:col-span-2">
          <CardHeader
            title="Documents"
            description="Every paper this record should hold, and which are missing"
          />
          <CardBody>
            <DocumentSlots memberId={member.id} canWrite={canWrite} />
          </CardBody>
        </Card>

        {/*
          The links that were here before uploads existed.

          Only rendered when a record actually has one. They were the whole
          answer until 2026-08-16 and eighteen people have values in them, so
          hiding them would look like the data had been lost — but a row of
          "Not on file" placeholders beneath a working uploader tells the
          reader nothing except that there are two systems.
        */}
        {member.cvUrl || member.appointmentLetterUrl || member.photoUrl ? (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Linked elsewhere"
              description="Google Drive links added before this app stored files"
            />
            <CardBody className="flex flex-wrap gap-2">
              {member.cvUrl ? (
                <DocumentLink href={member.cvUrl} label="CV" />
              ) : null}
              {member.appointmentLetterUrl ? (
                <DocumentLink
                  href={member.appointmentLetterUrl}
                  label="Appointment letter"
                />
              ) : null}
              {member.photoUrl ? (
                <DocumentLink href={member.photoUrl} label="Photo" />
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader
            title="Paid tools"
            description="What this person has a seat on, and what they used to"
          />
          <CardBody>
            <MemberTools
              memberId={member.id}
              numberFormat={settings.numberFormat}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Notes" />
          <CardBody className="text-sm">
            {member.notes ? (
              <p className="whitespace-pre-line">{member.notes}</p>
            ) : (
              <p className="text-muted-foreground">Nothing noted.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Pay closes the page rather than hiding behind a tab. The gate is
          unchanged — HR sees the locked card and the server refuses them
          independently — it is just no longer a click away from the rest. */}
      {!canSeePay ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Lock className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">Pay is not visible to you</p>
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

                  {/* The four lines behind the one figure. On the person, not
                      on a month — this is what they are paid, and the payslip
                      is where a particular month's version of it lives.

                      Each carries its share as well as its amount. The amount
                      is the fact and the share is the rule, and somebody
                      checking a payslip against the offer letter is reading
                      for the rule. */}
                  {currentPay.components?.length ? (
                    <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
                      {currentPay.components.map((part) => (
                        <div
                          key={part.label}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="text-muted-foreground">
                            {part.label}
                            <span className="num ml-1.5 text-xs text-faint">
                              {shareOf(part.amount, currentPay.grossAmount)}
                            </span>
                          </dt>
                          <dd>
                            <Amount
                              value={part.amount}
                              showCounterpart={false}
                            />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing recorded yet — they will be left off the salary sheet
                  until a figure exists.
                </p>
              )}
            </Card>
            {canSetPay ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setSettingPay(true)}
              >
                <Plus className="size-4" />
                Record a change
              </Button>
            ) : null}
          </div>

          <Card>
            <CardHeader
              title="Payslips"
              description="Every month they appear on a finalised salary sheet"
            />
            <CardBody className="p-0">
              {payslips.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                  No payslips yet — one appears here for each month whose salary
                  sheet has been finalised.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-data min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-left">
                        <Th>Month</Th>
                        <Th>Salary sheet</Th>
                        <Th className="text-right">Gross</Th>
                        <Th className="text-right">Tax</Th>
                        <Th className="text-right">Net</Th>
                        <Th className="w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((slip) => (
                        <tr key={slip.id} className="row-finance">
                          <td className="px-5 py-2.5">
                            <span className="font-medium">{slip.runLabel}</span>
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
                              prefetch={false}
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
      )}

      <StatusForm
        open={changingStatus}
        member={member}
        onClose={() => setChangingStatus(false)}
        onSaved={refresh}
      />
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
 * Resigned, let go, on leave, back at work.
 *
 * Its own drawer rather than a field buried in the edit form, because this is
 * the change with consequences: `active` is what the salary sheet selects on,
 * so the moment this is saved the person stops being generated onto next
 * month's payroll. Nothing is deleted — they keep their record, their history
 * and their payslips, and setting them back to Working undoes it.
 *
 * A last day is asked for whenever they are leaving and defaults to today,
 * because "when" is the question anybody asks next and it is far easier to
 * answer now than to reconstruct in March.
 */
function StatusForm({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member: TeamMemberDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<EmploymentStatus>(member.status);
  const [endedOn, setEndedOn] = useState(member.endedOn ?? todayInDhaka());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving takes a date; still being here cannot have one.
  const leaving = status === "resigned" || status === "terminated";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await teamApi.update(member.id, {
        status,
        // Cleared when they are not leaving, so somebody moved back to Working
        // does not keep a last day that has already passed.
        endedOn: leaving ? endedOn : null,
      });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Change status"
      description={member.fullName}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Status" required>
          <Select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as EmploymentStatus)
            }
          >
            {EMPLOYMENT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {EMPLOYMENT_STATUS_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        {leaving ? (
          <Field
            label="Last day"
            required
            hint="Their final working day. Payroll stops counting them after it."
          >
            <DateInput
              value={endedOn}
              onChange={(event) => setEndedOn(event.target.value)}
              required
            />
          </Field>
        ) : null}

        <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          {leaving
            ? "They stay on file with everything already recorded — pay history and payslips included. Only new salary sheets leave them out."
            : status === "on_leave"
              ? "On leave keeps them off new salary sheets without ending their employment."
              : "Working puts them back on the salary sheet from the next run."}
        </p>

        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Drawer>
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
  src,
}: {
  fullName: string;
  /** An uploaded file when there is one, otherwise the pasted Drive link. */
  src: string | null;
}) {
  const [broken, setBroken] = useState(false);
  const photoUrl = src;

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
function DocumentLink({ href, label }: { href: string | null; label: string }) {
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
/**
 * What share of the gross a component is, as the label states it.
 *
 * Worked out from the two figures rather than read from the rule in Settings.
 * The components were frozen at the raise that set them, so a person hired
 * under an older split still reads correctly — and if the rule changes
 * tomorrow, this page goes on describing what this person is actually on.
 */
function shareOf(part: string, gross: string): string {
  const whole = Number(gross);
  if (!Number.isFinite(whole) || whole <= 0) return "";
  const percent = (Number(part) / whole) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

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
          <DateInput
            name="effectiveFrom"
            required
            defaultValue={todayInDhaka()}
          />
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
        <Button
          type="submit"
          form="pay-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}
