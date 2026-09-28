"use client";

import type { Icon } from "@phosphor-icons/react";
import { AddressBookIcon } from "@phosphor-icons/react/dist/ssr/AddressBook";
import { AtIcon } from "@phosphor-icons/react/dist/ssr/At";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { BookOpenIcon } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { BriefcaseIcon } from "@phosphor-icons/react/dist/ssr/Briefcase";
import { CakeIcon } from "@phosphor-icons/react/dist/ssr/Cake";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { CalendarCheckIcon } from "@phosphor-icons/react/dist/ssr/CalendarCheck";
import { CalendarXIcon } from "@phosphor-icons/react/dist/ssr/CalendarX";
import { ChartLineUpIcon } from "@phosphor-icons/react/dist/ssr/ChartLineUp";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr/ClipboardText";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { CreditCardIcon } from "@phosphor-icons/react/dist/ssr/CreditCard";
import { DropIcon } from "@phosphor-icons/react/dist/ssr/Drop";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { FilesIcon } from "@phosphor-icons/react/dist/ssr/Files";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr/FolderOpen";
import { GenderIntersexIcon } from "@phosphor-icons/react/dist/ssr/GenderIntersex";
import { GitBranchIcon } from "@phosphor-icons/react/dist/ssr/GitBranch";
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr/Globe";
import { GraduationCapIcon } from "@phosphor-icons/react/dist/ssr/GraduationCap";
import { HandshakeIcon } from "@phosphor-icons/react/dist/ssr/Handshake";
import { HashIcon } from "@phosphor-icons/react/dist/ssr/Hash";
import { HourglassIcon } from "@phosphor-icons/react/dist/ssr/Hourglass";
import { HouseIcon } from "@phosphor-icons/react/dist/ssr/House";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr/IdentificationCard";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { MedalIcon } from "@phosphor-icons/react/dist/ssr/Medal";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { PathIcon } from "@phosphor-icons/react/dist/ssr/Path";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { PhoneIcon } from "@phosphor-icons/react/dist/ssr/Phone";
import { PulseIcon } from "@phosphor-icons/react/dist/ssr/Pulse";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { UserIcon } from "@phosphor-icons/react/dist/ssr/User";
import { UserSquareIcon } from "@phosphor-icons/react/dist/ssr/UserSquare";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import {
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_TYPE_LABELS,
  ENGAGEMENT_LABELS,
  GENDER_LABELS,
  PAYROLL_STATUS_LABELS,
  PSR_STATUS_LABELS,
  formatMoney,
  todayInDhaka,
  type EmploymentStatus,
} from "@finance/shared";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { UserGearIcon } from "@phosphor-icons/react/dist/ssr/UserGear";
import {
  LoaderCircle,
  Lock,
  Plus,
  Printer,
  Trash2,
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
import { StatusPill, type PillTone } from "@/components/ui/patterns";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
} from "@/components/ui/field";
import { BulkBar } from "@/components/ui/bulk-bar";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Pagination } from "@/components/ui/pagination";
import { RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
  TickCell,
  TickHead,
} from "@/components/ui/table";
import { useBulkSelect } from "@/components/ui/use-bulk-select";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { ApiError, fileHref, trashApi } from "@/lib/api-client";
import { PAGE_SIZE, pageCount, serial } from "@/lib/pagination";
import {
  teamApi,
  type CompensationDto,
  type TeamSocialDto,
  type EreturnDto,
  type MemberPayslipDto,
  type TeamMemberDto,
} from "@/lib/payroll";
import { formatDate, cn } from "@/lib/utils";
import { Ereturns } from "./ereturns";
import { SocialAccounts } from "./social-accounts";
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
  socials,
  ereturns,
  compensation,
  payslips,
}: {
  member: TeamMemberDto;
  /** Where they can be found. Empty when nothing is recorded. */
  socials: TeamSocialDto[];
  /** One filing per income year. */
  ereturns: EreturnDto[];
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
  /** Which section the tabs show; Overview is every one of them. */
  const [tab, setTab] = useState<ProfileTab>("overview");
  const shows = (section: Exclude<ProfileTab, "overview">) =>
    tab === "overview" || tab === section;
  /** The papers on file against the ones expected — told by the list. */
  const [docs, setDocs] = useState<{
    expected: number;
    received: number;
  } | null>(null);
  /** How many of the record's details are filled in. */
  const filled = RECORD_FIELDS.filter((field) => {
    const value = member[field];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;

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

  /* ------------------------------------------------------------------ */
  /*  Salary changes: the history, paged, and removable                  */
  /* ------------------------------------------------------------------ */

  /*
   * The owner: "ekhane pagination add koro and aro beshi data rakhte parbo.
   * also ekhane multiple select and trash a felar option tao diyo ei table a."
   * The screenshot showed two rows and one of them read "just test".
   *
   * `currentPay` is deliberately not in this list and therefore cannot be
   * ticked or deleted. That is not a UI nicety: it is the row every future
   * payroll sheet reads to work out what this person is paid, and the app has
   * no concept of a person with no current salary. The history behind it is
   * safe to remove — a sheet already built stores its own gross and does not
   * re-read this table.
   */
  const history = compensation.filter((row) => row.id !== currentPay?.id);

  /*
   * When a figure stopped: the day before the next one started.
   *
   * `compensation` arrives newest first, so the row that superseded any given
   * one is its predecessor in the array. Counted over the WHOLE list, not over
   * the page, so paging cannot change what a row says it ran until.
   */
  const untilOf = (row: CompensationDto): string | null => {
    const at = compensation.findIndex((c) => c.id === row.id);
    const next = at > 0 ? compensation[at - 1] : null;
    if (!next) return null;
    const d = new Date(`${next.effectiveFrom}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return formatDate(d.toISOString().slice(0, 10));
  };
  const [payPage, setPayPage] = useState(1);
  const payPages = pageCount(history.length);
  const payCurrent = Math.min(payPage, payPages);
  const payVisible = history.slice(
    (payCurrent - 1) * PAGE_SIZE,
    payCurrent * PAGE_SIZE,
  );
  /* Ticks belong to the page that is showing, like everywhere else. */
  const payBulk = useBulkSelect(payVisible);
  const [payBulkPending, setPayBulkPending] = useState(false);
  const [payBulkAsking, setPayBulkAsking] = useState(false);
  const [payBulkError, setPayBulkError] = useState<string | null>(null);

  const payDelete = useRowDelete<CompensationDto>({
    kind: "compensation",
    subject: "salary record",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">
          {formatMoney(row.grossAmount, {
            currency: settings.baseCurrency,
            format: settings.numberFormat,
          })}{" "}
          from {formatDate(row.effectiveFrom)}
        </span>
        <span className="text-xs text-muted-foreground">
          {row.changeReason ?? "No reason was recorded"}
        </span>
      </div>
    ),
    consequences: (
      <>
        <p>
          It leaves this history and the trash can put it back. What they are
          paid <span className="font-medium text-foreground">now</span> is not
          in this list and does not change.
        </p>
        <p className="mt-2">
          {/*
            Measured, not assumed: a payroll line stores its own gross when the
            sheet is built (`payroll_lines.gross_amount`), so nothing that has
            been finalised or paid can move. The one live edge is a DRAFT
            sheet, whose pro-rata path re-reads this table — so a draft built
            before the delete keeps its figure until somebody edits Working
            days on that line, and then it rebases.
          */}
          Salary sheets already finalised or paid keep their figures — they
          store their own. A{" "}
          <span className="font-medium text-foreground">draft</span> sheet keeps
          what it has too, until somebody edits that person&rsquo;s working
          days, which works the pay out from this history again.
        </p>
      </>
    ),
    onDone: refresh,
  });
  // The sheet has an Age column. Storing it would be storing something that is
  // wrong by the next birthday, so it is counted from the date of birth.
  const age = member.dateOfBirth ? ageInYears(member.dateOfBirth) : null;

  return (
    <>
      {/*
        The profile, drawn after the HR portal's own (the owner's reference,
        28 Sep 2026: "screenshots a jevabe header sundor vabe add kora tarpor
        section gular jonne sundor nevigation. prottekta item er jonne icons").
        Nothing on it is new: every field, card and action is the one the page
        already had, arranged under a banner, two progress figures and a row of
        tabs. `sv-profile` scopes the card-heading style in new-design.css to
        this page, so the cards other components draw here (social accounts,
        e-returns, the documents list) wear it too.
      */}
      <div className="sv-profile flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/team"
            className="inline-flex w-fit items-center gap-1.5 text-[13.5px] font-extrabold text-(--sv-violet-ink) transition-colors hover:text-(--sv-ink)"
          >
            <ArrowLeftIcon weight="bold" size={15} />
            All team
          </Link>
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
                <UserGearIcon
                  weight="duotone"
                  size={18}
                  className="text-(--sv-violet)"
                />
                Change status
              </Button>
              <Button variant="primary" size="md" onClick={() => setEditing(true)}>
                <PencilSimpleIcon weight="duotone" size={18} />
                Edit record
              </Button>
            </div>
          ) : null}
        </div>

        {/* The banner: the violet band, the photo over its edge, the name and
            the four facts somebody looks for first. */}
        <Card className="sv-profile-hero sv-rise overflow-hidden">
          <div aria-hidden="true" className="sv-profile-banner">
            <span className="sv-profile-banner-sun" />
            <span className="sv-profile-banner-moon" />
          </div>
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3 px-6 pb-5">
            <div className="relative z-[1] -mt-12 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => photoSrc && setViewingPhoto(true)}
                className={cn(
                  "sv-profile-avatar rounded-full",
                  photoSrc ? "cursor-zoom-in" : "cursor-default",
                )}
                aria-label={
                  photoSrc ? `View ${member.fullName}'s photo` : undefined
                }
              >
                <MemberPhoto
                  // Resets the broken-image state when the picture itself
                  // changes, including the moment a new one finishes uploading.
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

            <div className="min-w-0 flex-1 pt-3.5">
              <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
                {member.fullName}
              </h1>
              <p className="mt-0.5 text-[14.5px] text-(--sv-muted)">
                {[member.designation, member.department]
                  .filter(Boolean)
                  .join(" · ") || ENGAGEMENT_LABELS[member.engagementType]}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {member.employeeCode ? (
                  <span className="sv-profile-chip">{member.employeeCode}</span>
                ) : null}
                <StatusPill tone={STATUS_TONES[member.status]}>
                  {EMPLOYMENT_STATUS_LABELS[member.status]}
                </StatusPill>
                {member.employmentType ? (
                  <span className="sv-profile-chip">
                    {EMPLOYMENT_TYPE_LABELS[member.employmentType]}
                  </span>
                ) : null}
                <span className="sv-profile-chip">
                  Joined {formatDate(member.joinedOn)}
                </span>
              </div>
            </div>
          </div>
        </Card>

        {/* Two figures that say how complete this record is. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ProgressCard
            icon={FilesIcon}
            label="Documents"
            value={docs ? `${docs.received} of ${docs.expected}` : "…"}
            ratio={docs && docs.expected ? docs.received / docs.expected : 0}
            note={
              docs
                ? docs.expected - docs.received === 0
                  ? "Every expected paper is on file"
                  : `${docs.expected - docs.received} still to come`
                : "Reading the papers on file"
            }
          />
          <ProgressCard
            icon={ClipboardTextIcon}
            label="Record"
            value={`${Math.round((filled / RECORD_FIELDS.length) * 100)}%`}
            ratio={filled / RECORD_FIELDS.length}
            note={
              filled === RECORD_FIELDS.length
                ? "Every detail is filled in"
                : `${RECORD_FIELDS.length - filled} of ${RECORD_FIELDS.length} details still blank`
            }
          />
        </div>

        {/* The sections, one tab each — Overview is all of them. */}
        <nav
          aria-label="Sections of this profile"
          className="sv-card sv-profile-tabs flex flex-wrap gap-1 rounded-[11px] bg-(--sv-surface) p-1.5"
        >
          {PROFILE_TABS.map((one) => (
            <button
              key={one.key}
              type="button"
              aria-pressed={tab === one.key}
              data-active={tab === one.key ? "" : undefined}
              onClick={() => setTab(one.key)}
              className="sv-profile-tab"
            >
              <one.icon weight="duotone" size={18} />
              {one.label}
            </button>
          ))}
        </nav>

        {/* Everything the sheet carries, in the sheet's own words, so a row
            here and a column there are the same field. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shows("personal") ? (
            <Card>
              <CardHeader title="Employee details" icon={IdentificationCardIcon} />
              <CardBody className="sv-profile-rows">
                <Row icon={UserIcon} label="Name of Employee" value={member.fullName} />
                <Row icon={MedalIcon} label="Designation" value={member.designation} />
                <Row icon={HourglassIcon} label="Age">
                  {age !== null ? (
                    <>
                      <span className="num">{age}</span> yrs
                    </>
                  ) : null}
                </Row>
                <Row
                  icon={GenderIntersexIcon}
                  label="Gender"
                  value={member.gender ? GENDER_LABELS[member.gender] : null}
                />
                <Row icon={DropIcon} label="Blood Group" value={member.bloodGroup} />
                <Row
                  icon={CakeIcon}
                  label="Date Of Birth"
                  mono
                  value={formatDate(member.dateOfBirth)}
                />
                <Row icon={IdentificationCardIcon} label="NID Number" mono value={member.nid} />
              </CardBody>
            </Card>
          ) : null}

          {shows("personal") ? (
            <Card>
              <CardHeader title="Contact" icon={AddressBookIcon} />
              <CardBody className="sv-profile-rows">
                <Row icon={PhoneIcon} label="Contact No." mono value={member.phone} />
                <Row icon={EnvelopeSimpleIcon} label="Email" value={member.personalEmail} />
                <Row icon={AtIcon} label="Work email" value={member.workEmail} />
                <Row icon={HouseIcon} label="Present Address" value={member.address} />
                <Row icon={MapPinIcon} label="Permanent Address" value={member.permanentAddress} />
              </CardBody>
            </Card>
          ) : null}

          {shows("employment") ? (
            <Card>
              <CardHeader
                title="Employment"
                icon={BriefcaseIcon}
                description="Joining Salary is what was agreed at hire — what they are paid now is below"
              />
              <CardBody className="sv-profile-rows">
                <Row
                  icon={CalendarCheckIcon}
                  label="Date of Joining"
                  mono
                  value={formatDate(member.joinedOn)}
                />
                <Row icon={MoneyIcon} label="Joining Salary">
                  {member.joiningSalary ? (
                    <Amount value={member.joiningSalary} className="font-medium" />
                  ) : null}
                </Row>
                {/* What SOMEBODY ELSE paid them, from the HR app. Read-only
                    context, never arithmetic -- and deliberately not styled like
                    the line above it, because the two are opposite facts and a
                    reader glancing down this card must not add them. */}
                <Row icon={ClockCounterClockwiseIcon} label="Previous Employer Salary">
                  {member.previousOrgSalary ? (
                    <Amount value={member.previousOrgSalary} />
                  ) : null}
                </Row>
                <Row
                  icon={GraduationCapIcon}
                  label="Education Level"
                  value={
                    member.educationLevel
                      ? EDUCATION_LEVEL_LABELS[member.educationLevel]
                      : null
                  }
                />
                <Row icon={BookOpenIcon} label="Education Major" value={member.educationMajor} />
              </CardBody>
            </Card>
          ) : null}

          {/* Not on the sheet. These are the app's own — the code it files
              people under, and the status the salary sheet reads. */}
          {shows("employment") ? (
            <Card>
              <CardHeader title="Record" icon={ClipboardTextIcon} />
              <CardBody className="sv-profile-rows">
                <Row
                  icon={HandshakeIcon}
                  label="Engaged as"
                  value={ENGAGEMENT_LABELS[member.engagementType]}
                />
                <Row icon={UsersThreeIcon} label="Department" value={member.department} />
                <Row icon={PulseIcon} label="Status">
                  <StatusPill tone={STATUS_TONES[member.status]}>
                    {EMPLOYMENT_STATUS_LABELS[member.status]}
                  </StatusPill>
                </Row>
                {/*
                  Only for somebody who has one.

                  A row reading "Last day —" against a person who is working
                  says nothing, and reads as a gap in the record rather than as
                  the absence of an event. It appears the moment a status is set
                  that implies leaving, which is also the moment the form asks
                  for the date.
                */}
                {member.endedOn || !working ? (
                  <Row
                    icon={CalendarXIcon}
                    label="Last day"
                    mono
                    value={formatDate(member.endedOn)}
                  />
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {shows("pay") ? (
            <Card>
              <CardHeader
                title="Tax"
                icon={PercentIcon}
                description="Missing PSR raises the withholding rate by half"
              />
              <CardBody className="sv-profile-rows">
                <Row icon={HashIcon} label="e-TIN" mono value={member.etin} />
                <Row icon={FileTextIcon} label="Return filed">
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
                  icon={CalendarBlankIcon}
                  label="Assessment year"
                  mono
                  value={member.psrAssessmentYear}
                />
              </CardBody>
            </Card>
          ) : null}

          {shows("pay") ? (
            <Card>
              <CardHeader title="Where they are paid" icon={BankIcon} />
              <CardBody className="sv-profile-rows">
                {/*
                  The six a salary transfer actually needs, in the order a bank
                  form asks for them.

                  The account HOLDER is the one most likely to be the reason a
                  payment bounced: a salary often goes to an account in a name
                  that is not exactly the employee's — a father's name, a joint
                  account, a maiden name — and the bank refuses a transfer whose
                  beneficiary name does not match.

                  Wallet and Wallet number are gone on the owner's word. They
                  were N/A for everybody; the columns stay in the database, so
                  nothing recorded is lost if a wallet is ever wanted again.
                */}
                <Row icon={BankIcon} label="Bank" value={member.bankName} />
                <Row icon={UserSquareIcon} label="Account holder" value={member.bankAccountHolder} />
                <Row icon={CreditCardIcon} label="Account" mono value={member.bankAccountNumber} />
                <Row icon={GitBranchIcon} label="Branch" value={member.bankBranch} />
                <Row icon={PathIcon} label="Routing" mono value={member.bankRouting} />
                <Row icon={GlobeIcon} label="SWIFT" mono value={member.bankSwift} />
              </CardBody>
            </Card>
          ) : null}

          {shows("documents") ? (
            <Card className="lg:col-span-2">
              <CardHeader
                title="Documents"
                icon={FilesIcon}
                description="Every paper this record should hold, and which are missing"
              />
              <CardBody>
                <DocumentSlots
                  memberId={member.id}
                  canWrite={canWrite}
                  /* `working` counts on_leave as still here, which is right: a
                     person on leave has not resigned. */
                  hasLeft={!working}
                  onSummary={setDocs}
                />
              </CardBody>
            </Card>
          ) : null}

          {/* The "Linked elsewhere" card is gone on the owner's instruction:
            every paper now lives in the app's own store, uploaded from the
            drawer or the Documents card above. The three URL columns keep their
            values in the database — they are simply no longer shown or
            written. */}

          {/* `min-w-0` is load-bearing, not tidying. A grid item's default
              `min-width: auto` sizes it to its contents, so the sixteen-column
              tools table below pushed this card wider than its track and the
              whole profile scrolled sideways by a thousand pixels. */}
          {shows("tools") ? (
            <Card className="min-w-0 overflow-hidden lg:col-span-2">
              <CardHeader
                title="Paid tools"
                icon={SparkleIcon}
                description="What this person has a seat on, and what they used to"
              />
              <CardBody>
                <MemberTools memberId={member.id} />
              </CardBody>
            </Card>
          ) : null}

          {shows("employment") ? (
            <Card className="lg:col-span-2">
              <CardHeader title="Notes" icon={NotePencilIcon} />
              <CardBody className="text-sm">
                {member.notes ? (
                  <p className="whitespace-pre-line">{member.notes}</p>
                ) : (
                  <p className="text-muted-foreground">Nothing noted.</p>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* Pay closes the page rather than hiding behind a tab of its own. The
            gate is unchanged — HR sees the locked card and the server refuses
            them independently. */}
        {!shows("pay") && !shows("personal") ? null : !canSeePay ? (
          shows("pay") ? (
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
          ) : null
        ) : (
          <>
            {shows("pay") ? (
              <Card>
                <CardHeader
                  title="Pay"
                  icon={MoneyIcon}
                  description="Current gross, monthly — what the salary sheet reads"
                  action={
                    canSetPay ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setSettingPay(true)}
                      >
                        <Plus className="size-4" />
                        Record a change
                      </Button>
                    ) : undefined
                  }
                />
                <CardBody>
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
                      Since {formatDate(currentPay.effectiveFrom)}
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
                </CardBody>
              </Card>
            ) : null}

            {/*
              Where they can be found — always rendered, unlike Salary changes:
              an empty one is an invitation to add the first account. It carries
              its own drawer, so nothing about the big edit form has to change.
            */}
            {shows("personal") ? (
              <SocialAccounts
                memberId={member.id}
                memberName={member.fullName}
                socials={socials}
                canWrite={canWrite}
                onSaved={refresh}
              />
            ) : null}

            {/* Tax: the year, the acknowledgement, and nothing invented. The
                e-TIN itself is a field on the person, above. */}
            {shows("pay") ? (
              <Ereturns
                memberId={member.id}
                memberName={member.fullName}
                ereturns={ereturns}
                canWrite={canWrite}
                onSaved={refresh}
              />
            ) : null}

            {shows("pay") ? (
              <>
            {history.length > 0 ? (
              <Card>
                <CardHeader
                  title="Salary changes"
                  icon={ChartLineUpIcon}
                  description="What they were paid before, and why it changed"
                />
                <CardBody className="p-0">
                  <TableScroll>
                    {/* Only once something is ticked; otherwise the panel is
                        exactly as it was. */}
                    {/*
                      No money on this bar, deliberately. Everywhere else it
                      states the total the selection is worth, because those are
                      entries in a ledger and their sum is a real figure. Three
                      historical monthly salaries added together is not a figure
                      at all — it is not what anybody was paid, or owed, or is
                      about to lose. So the bar says how many, and stops.
                    */}
                    <BulkBar
                      count={payBulk.count}
                      noun="salary record"
                      pending={payBulkPending}
                      onClear={payBulk.clear}
                      onTrash={() => {
                        setPayBulkError(null);
                        setPayBulkAsking(true);
                      }}
                    />
                    <table className="table-data min-w-[760px] text-sm">
                      <thead>
                        <tr className="text-left">
                          {canSetPay ? (
                            <TickHead
                              state={payBulk.headerState}
                              onChange={payBulk.allOnPage}
                            />
                          ) : null}
                          <SerialHead />
                          <Th width="w-32">From</Th>
                          <Th width="w-32">Until</Th>
                          <Th align="right">Gross, monthly</Th>
                          <Th>Why it changed</Th>
                          {/* The same unlabelled heading every other table's
                              action column uses, at its narrow width — one
                              button, not three. */}
                          {canSetPay ? <RowActionsHead /> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {payVisible.map((row, index) => (
                          <tr key={row.id} className="row-finance">
                            {canSetPay ? (
                              <TickCell
                                checked={payBulk.isTicked(row.id)}
                                onChange={() => payBulk.toggle(row.id)}
                                label={`${row.grossAmount} from ${row.effectiveFrom}`}
                              />
                            ) : null}
                            {/* Counted across pages, so the twenty-first row is
                                21 rather than a second 1. */}
                            <SerialCell n={serial(payCurrent, index)} />
                            <td className="num text-muted-foreground">
                              {formatDate(row.effectiveFrom)}
                            </td>
                            <td className="num text-muted-foreground">
                              {/*
                                Read from the row that follows, not from the
                                stored `effective_to`.

                                Nothing in this app resolves a salary through
                                `effective_to` — payroll and the directory both
                                take the newest row whose `effective_from` is on
                                or before the date they want. The column is
                                written once, when the NEXT change closes this
                                row, and nothing repairs it afterwards. So
                                deleting a row out of the middle of a history
                                leaves its predecessor stamped with an end date
                                that came from a row nobody can see any more:
                                the money quietly carries on at the predecessor's
                                figure while this column claims it stopped months
                                ago. Display and money disagreeing, with only the
                                display wrong.

                                Derived here, they cannot disagree.
                              */}
                              {untilOf(row) ?? "—"}
                            </td>
                            <td className="num text-right">
                              <Amount
                                value={row.grossAmount}
                                showCounterpart={false}
                              />
                            </td>
                            <td className="text-muted-foreground">
                              {row.changeReason ?? "—"}
                            </td>
                            {canSetPay ? (
                              /*
                                One button, written here rather than through
                                `RowActions`.

                                That component takes a REQUIRED second verb —
                                void, deactivate, archive, delete, status — and
                                renders Edit beside it. This row supports
                                neither: a historical salary cannot be edited
                                (the API only ever appends a new one, which is
                                what makes the history a history), and it has no
                                second act. Passing a verb to satisfy the type
                                would put two dead icons on every row, and making
                                `second` optional is a change to the nineteen
                                screens that use it — which is the owner's call,
                                not this page's.
                              */
                              <td>
                                <div className="flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => payDelete.ask(row)}
                                    aria-label="Move to trash"
                                    title="Move to trash"
                                    className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-negative"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                </div>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                </CardBody>
                {/* A sibling of the table, not inside it — it renders nothing at
                    all while the history fits on one page. */}
                <Pagination
                  page={payCurrent}
                  totalPages={payPages}
                  total={history.length}
                  noun="salary record"
                  nounPlural="salary records"
                  onPage={setPayPage}
                />
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Payslips"
                icon={ReceiptIcon}
                description="Every month they appear on a finalised salary sheet"
              />
              <CardBody className="p-0">
                <TableScroll>
                  <table className="table-data min-w-[780px] text-sm">
                    <thead>
                      <tr className="text-left">
                        <SerialHead />
                        <Th>Paid on</Th>
                        <Th>Salary sheet</Th>
                        <Th align="right">Gross</Th>
                        <Th align="right">Tax</Th>
                        <Th align="right">Net</Th>
                        <Th>Status</Th>
                        <Th width="w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.length === 0 ? (
                        <TableMessageRow colSpan={8}>
                          No payslips yet — one appears here for each month whose
                          salary sheet has been finalised.
                        </TableMessageRow>
                      ) : (
                        payslips.map((slip, index) => (
                          <tr key={slip.id} className="row-finance">
                            <SerialCell n={index + 1} />
                            {/* A sheet can be finalised before it is paid, and
                                then there is no date to show. The dash is the
                                honest answer — Status is where the reason is. */}
                            <td
                              className={cn(
                                "num",
                                !slip.paidOn && "text-muted-foreground",
                              )}
                            >
                              {/* #1 rewired the whole app to day/month/year and
                                  missed this one cell — the profile was not on
                                  the sweep, which walked seven list screens and
                                  no detail page. The owner found it by looking:
                                  Salary changes above reads 30/08/2026 and this
                                  read 2026-06-29. */}
                              {slip.paidOn ? formatDate(slip.paidOn) : "N/A"}
                            </td>
                            <td>
                              {/* One link per row — see the note in
                                  team-screen.tsx. */}
                              <Link
                                href={`/payroll/${slip.runId}`}
                                prefetch={false}
                                className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                              >
                                {slip.runLabel}
                              </Link>
                            </td>
                            <td>
                              <Amount
                                value={slip.grossAmount}
                                tone="neutral"
                                className="block"
                              />
                            </td>
                            <td>
                              <Amount
                                value={slip.tdsAmount}
                                tone="neutral"
                                className="block"
                              />
                            </td>
                            <td>
                              <Amount
                                value={slip.netAmount}
                                tone="neutral"
                                className="block font-medium"
                              />
                            </td>
                            <td>
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
                            <td className="text-right">
                              {/*
                                  The route's segment is named runId but carries
                                  the payroll line id — one payslip is one line.
                                */}
                              <Link
                                href={`/payroll/${slip.id}/payslip`}
                                prefetch={false}
                                className="inline-flex items-center gap-1 text-xs text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
                              >
                                <Printer className="size-3" />
                                Payslip
                              </Link>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </TableScroll>
              </CardBody>
            </Card>
              </>
            ) : null}
          </>
        )}
      </div>

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

      {/* One row at a time, and the whole ticked page. Both outside the card,
          so neither disappears with the branch that renders the table. */}
      {payDelete.dialog}
      <DeleteDialog
        open={payBulkAsking}
        subject="salary record"
        count={payBulk.count}
        summary={
          <>
            {payBulk.selected
              .slice(0, 5)
              .map((row) => `${formatDate(row.effectiveFrom)}`)
              .join(", ")}
            {payBulk.count > 5 ? ` and ${payBulk.count - 5} more` : ""}
          </>
        }
        consequences={
          <p>
            They leave this history and the trash can put them back. What this
            person is paid{" "}
            <span className="font-medium text-foreground">now</span> is not in
            this list and does not change, and no salary sheet already built
            moves — a sheet stores its own figures.
          </p>
        }
        pending={payBulkPending}
        error={payBulkError}
        onCancel={() => setPayBulkAsking(false)}
        onConfirm={(reason) => {
          setPayBulkPending(true);
          setPayBulkError(null);
          void trashApi
            .removeMany(
              "compensation",
              payBulk.selected.map((row) => row.id),
              reason,
            )
            .then(() => {
              setPayBulkAsking(false);
              payBulk.clear();
              refresh();
            })
            .catch((err: unknown) =>
              setPayBulkError(
                err instanceof ApiError ? err.message : "That did not work.",
              ),
            )
            .finally(() => setPayBulkPending(false));
        }}
      />
    </>
  );
}

type ProfileTab =
  | "overview"
  | "personal"
  | "employment"
  | "pay"
  | "documents"
  | "tools";

/** The tabs, each a section of the page; Overview shows them all. */
const PROFILE_TABS: { key: ProfileTab; label: string; icon: Icon }[] = [
  { key: "overview", label: "Overview", icon: SquaresFourIcon },
  { key: "personal", label: "Personal", icon: IdentificationCardIcon },
  { key: "employment", label: "Employment", icon: BriefcaseIcon },
  { key: "pay", label: "Pay & bank", icon: BankIcon },
  { key: "documents", label: "Documents", icon: FolderOpenIcon },
  { key: "tools", label: "Paid tools", icon: SparkleIcon },
];

/**
 * The details the Record figure counts — the ones a complete record of a
 * person has, all of them fields already on it. Nothing here is required by
 * the form; the figure only says how many are still blank.
 */
const RECORD_FIELDS = [
  "employeeCode",
  "designation",
  "department",
  "dateOfBirth",
  "gender",
  "bloodGroup",
  "nid",
  "phone",
  "personalEmail",
  "workEmail",
  "address",
  "permanentAddress",
  "educationLevel",
  "bankName",
  "bankAccountNumber",
] as const satisfies readonly (keyof TeamMemberDto)[];

/** One of the two figures above the tabs: a label, a number and its bar. */
function ProgressCard({
  icon: Glyph,
  label,
  value,
  ratio,
  note,
}: {
  icon: Icon;
  label: string;
  value: string;
  /** 0 to 1. */
  ratio: number;
  note: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return (
    <Card className="sv-rise flex items-start gap-3.5 px-5 py-4">
      <span className="grid size-10 flex-none place-items-center rounded-[11px] bg-(--sv-violet-tint) text-(--sv-violet)">
        <Glyph weight="duotone" size={21} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-extrabold tracking-[0.14em] text-(--sv-muted) uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-[22px] font-extrabold tracking-[-0.01em] tabular-nums">
          {value}
        </p>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-2 h-2 overflow-hidden rounded-full bg-(--sv-track)"
        >
          <div
            className="h-full rounded-full bg-(--sv-violet) transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12.5px] text-(--sv-muted)">{note}</p>
      </div>
    </Card>
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
      <span className="flex size-24 shrink-0 items-center justify-center rounded-full bg-(--sv-accent) text-[28px] font-extrabold text-(--sv-on-accent)">
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
      className="size-24 shrink-0 rounded-full object-cover"
    />
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
 * One line of a profile. A field nobody has filled in still gets its label and
 * a muted dash — a label with nothing after it reads as a rendering fault.
 */
function Row({
  icon: Glyph,
  label,
  value,
  children,
  mono = false,
}: {
  /** The small violet mark before the label — the reference design's. */
  icon: Icon;
  label: string;
  value?: string | null;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  const content = children ?? value;
  const empty = content === null || content === undefined || content === "";

  return (
    <div className="sv-profile-row">
      <span className="flex min-w-0 items-center gap-2.5 text-(--sv-muted)">
        <Glyph
          weight="duotone"
          size={17}
          className="flex-none text-(--sv-violet)"
        />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "min-w-0 wrap-break-word",
          mono && "tabular-nums",
          empty ? "text-(--sv-muted)" : "font-extrabold",
        )}
      >
        {empty ? "N/A" : content}
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

/** The same tones as the team list: working violet, on leave amber, left grey,
 *  terminated red. */
const STATUS_TONES: Record<EmploymentStatus, PillTone> = {
  active: "primary",
  on_leave: "warning",
  resigned: "neutral",
  terminated: "negative",
};
