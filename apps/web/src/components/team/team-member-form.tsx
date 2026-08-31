"use client";

import {
  BLOOD_GROUPS,
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_TYPES,
  GENDERS,
  GENDER_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { Paperclip, X } from "lucide-react";

import { useCan } from "@/components/auth/session-provider";
import {
  PreviewButton,
  useFilePreview,
  type Stored,
} from "@/components/files/file-preview";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  fileHref,
  listTeamMemberFiles,
  uploadTeamMemberFile,
} from "@/lib/api-client";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";

/**
 * Enums on the API side, where "" is not a valid answer. An unanswered one is
 * left out of the request rather than sent empty.
 */
const OMIT_WHEN_BLANK = [
  "gender",
  "bloodGroup",
  "educationLevel",
  "employmentType",
] as const;

export function TeamMemberForm({
  open,
  member,
  onClose,
  onSaved,
}: {
  open: boolean;
  member?: TeamMemberDto;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const editing = Boolean(member);
  /*
   * Whether this person may set pay at all. HR can open this drawer but does
   * not hold the compensation permission, so HR never sees the Current salary
   * field — and the API refuses the key regardless, so hiding it is a
   * courtesy rather than the guard.
   */
  const canSetPay = useCan("team.compensation.write");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /*
   * The figure they are on right now, fetched when the drawer opens on an
   * existing person. Null while unknown — the field waits for it, because an
   * uncontrolled input takes its defaultValue exactly once, and mounting the
   * box empty and filling it later would show a blank over a real salary.
   * On create there is nothing to fetch and the box starts empty.
   */
  const [salaryNow, setSalaryNow] = useState<string | null>(member ? null : "");

  /*
   * The papers, held here and uploaded AFTER the save — on create there is no
   * id to attach them to until the API answers. They land in the app's own
   * file store under the person, exactly where the profile's Documents card
   * reads, on the owner's rule that nothing lives on a third-party link.
   */
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [letterFile, setLetterFile] = useState<File | null>(null);

  /*
   * What this person ALREADY has on file.
   *
   * Without it the drawer opened saying "Photo — Choose a file" at somebody
   * whose photograph was on the screen behind it, and the owner read that,
   * reasonably, as the app having lost the file. The text boxes have always
   * carried their saved values; the three file rows were the only fields that
   * opened blank whatever was stored.
   *
   * Fetched here rather than passed in, because both call sites — the profile
   * and the team list — would otherwise have to fetch it and hand it over, and
   * one of them would eventually not.
   */
  /*
   * Keyed by whose papers these are, rather than cleared when the drawer
   * shuts. Clearing meant a synchronous setState in the effect body — the
   * cascading-render rule refuses it, rightly — and comparing the id does the
   * same job better: one person's documents can never be shown against
   * another's, however the two requests happen to land.
   */
  const [loadedFor, setLoadedFor] = useState<{
    id: string;
    files: Record<string, Stored>;
  } | null>(null);
  const onFile = member && loadedFor?.id === member.id ? loadedFor.files : null;
  const preview = useFilePreview();

  useEffect(() => {
    if (!open || !member) return;
    let live = true;
    void listTeamMemberFiles(member.id)
      .then((files) => {
        if (!live) return;
        /*
         * The newest of each kind. A slot can hold several — "Add another" is
         * on the profile's Documents card — and the one worth naming here is
         * the one that would be shown as current.
         */
        const newest: Record<string, Stored> = {};
        for (const file of files) {
          if (!newest[file.kind]) {
            newest[file.kind] = {
              name: file.originalName,
              href: fileHref(file.id),
              isImage: file.isImage,
            };
          }
        }
        /*
         * The photograph is NOT in that list, and deliberately: the API
         * excludes `profile_photo` from a person's documents because the
         * picture has its own control beside the face it belongs to, and
         * listing it twice makes the delete button look like it removes a
         * duplicate. The record carries its id, so it comes from there.
         */
        if (member.photoFileId) {
          newest.profile_photo = {
            name: "Current photo",
            href: fileHref(member.photoFileId),
            isImage: true,
          };
        }
        setLoadedFor({ id: member.id, files: newest });
      })
      .catch(() => {
        // A drawer that cannot list the papers still has to open and save.
        if (live) setLoadedFor({ id: member.id, files: {} });
      });
    return () => {
      live = false;
    };
  }, [open, member]);
  const toast = useToast();
  useEffect(() => {
    if (!open || !member || !canSetPay) return;
    let cancelled = false;
    teamApi
      .currentSalaries()
      .then((rows) => {
        if (cancelled) return;
        const mine = rows.find((r) => r.teamMemberId === member.id);
        setSalaryNow(mine?.grossAmount ?? "");
      })
      .catch(() => {
        // The drawer still opens; the box simply starts empty.
        if (!cancelled) setSalaryNow("");
      });
    return () => {
      cancelled = true;
    };
  }, [open, member, canSetPay]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");

    // Exactly the company's sheet, plus what the app itself runs on — a code,
    // an engagement type, and the bank and tax details payroll needs. The
    // columns that are retained but no longer collected are simply not sent:
    // an update is partial, so whatever was typed in before this change stays
    // where it is rather than being blanked on the next save.
    const payload = {
      fullName: text("fullName"),
      // Sent as "" when the box is emptied, which the schema maps to null —
      // clearing an ID has to be possible, and an omitted key would mean
      // "leave it alone" on a patch.
      employeeCode: String(data.get("employeeCode") ?? ""),
      engagementType: text("engagementType"),
      department: text("department"),
      designation: text("designation"),
      joinedOn: text("joinedOn"),
      personalEmail: text("personalEmail"),
      workEmail: text("workEmail"),
      phone: text("phone"),
      nid: text("nid"),
      etin: text("etin"),
      psrAssessmentYear: text("psrAssessmentYear"),
      bankName: text("bankName"),
      bankAccountHolder: text("bankAccountHolder"),
      bankAccountNumber: text("bankAccountNumber"),
      bankBranch: text("bankBranch"),
      bankRouting: text("bankRouting"),
      bankSwift: text("bankSwift").toUpperCase(),
      address: text("address"),
      notes: text("notes"),
      dateOfBirth: text("dateOfBirth"),
      permanentAddress: text("permanentAddress"),
      // The offer figure, not payroll. Raises are set on the Pay tab, which
      // this drawer cannot reach and HR cannot open.
      joiningSalary: text("joiningSalary"),
      // Pay, not paperwork — only when this person may set it. On an edit the
      // API skips a figure equal to the current one, so saving the drawer
      // untouched manufactures nothing. Sent blank it would fail the schema,
      // so it is omitted instead — a cleared box means "no change", not zero.
      ...(canSetPay && text("currentSalary")
        ? { currentSalary: text("currentSalary") }
        : {}),
      educationMajor: text("educationMajor"),
      ...(editing ? { status: text("status"), endedOn: text("endedOn") } : {}),
    } as Parameters<typeof teamApi.create>[0];

    for (const key of OMIT_WHEN_BLANK) {
      const value = text(key);
      if (value) (payload as Record<string, unknown>)[key] = value;
    }

    try {
      const saved = member
        ? await teamApi.update(member.id, payload)
        : await teamApi.create(payload);

      /*
       * The person is saved either way — a failed upload must not undo that,
       * and retrying the whole form would create them twice. So each file is
       * tried once and a failure is a toast naming the paper, which can then
       * be added from the profile's Documents card.
       */
      const papers: Array<[File | null, string, string]> = [
        [photoFile, "profile_photo", "photo"],
        [cvFile, "cv", "CV"],
        [letterFile, "appointment_letter", "appointment letter"],
      ];
      for (const [file, kind, name] of papers) {
        if (!file) continue;
        try {
          await uploadTeamMemberFile(saved.id, file, kind);
        } catch {
          toast.show(
            `Saved, but the ${name} did not upload — add it from the profile's Documents card.`,
            "error",
          );
        }
      }

      await onSaved();
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
      title={editing ? "Edit person" : "Add a person"}
      description="A name, a code and a joining date are enough — the rest is filled in as it becomes known. Pay is recorded separately, on the Pay tab."
    >
      <form
        id="member-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/*
              Two questions that look like one, and are not.

              "Type" decides whether payroll draws somebody on the salary sheet
              or whether they bill — it is what the monthly run reads, and the
              wrong answer here is a missing payslip. "Employment type" is the
              employment record: where and on what footing they work. They sit
              side by side because whoever fills this in answers both at once,
              and the hints say which is which so the pair cannot be read as a
              duplicate.
          */}
          <Field label="Type" required hint="What payroll does with them">
            <Select
              name="engagementType"
              defaultValue={member?.engagementType ?? "employee"}
            >
              {ENGAGEMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ENGAGEMENT_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
          {/*
              "Not set" is a real answer and stays selectable.

              Nobody has been asked this about the people already on record, so
              the blank is what most of them hold; an option list that cannot
              express it would make the first person to open somebody's drawer
              pick a value on their behalf just to save an unrelated edit.
          */}
          <Field label="Employment type" hint="Where and on what footing">
            <Select
              name="employmentType"
              defaultValue={member?.employmentType ?? ""}
            >
              <option value="">Not set</option>
              {EMPLOYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EMPLOYMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={fieldErrors.fullName}>
            <Input name="fullName" required defaultValue={member?.fullName} />
          </Field>
          <Field
            label="Employee ID"
            error={fieldErrors.employeeCode}
            hint="The company's own — leave empty if there is none"
          >
            <Input
              name="employeeCode"
              className="num"
              maxLength={40}
              placeholder="SVF-0012"
              defaultValue={member?.employeeCode ?? ""}
            />
          </Field>
        </div>

        <PaperPick
          label="Photo"
          hint="Uploads into the app when you save — it appears on the profile"
          accept="image/*"
          file={photoFile}
          stored={onFile?.profile_photo}
          onPick={setPhotoFile}
          onPreview={preview.show}
        />

        <SectionHeading>Personal</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date of birth" error={fieldErrors.dateOfBirth}>
            <DateInput
              name="dateOfBirth"
              defaultValue={member?.dateOfBirth ?? ""}
            />
          </Field>
          <Field label="Gender">
            <Select name="gender" defaultValue={member?.gender ?? ""}>
              <option value="">Not set</option>
              {GENDERS.map((option) => (
                <option key={option} value={option}>
                  {GENDER_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Blood group" hint="For the day somebody needs it fast">
            <Select name="bloodGroup" defaultValue={member?.bloodGroup ?? ""}>
              <option value="">Not set</option>
              {BLOOD_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="NID" error={fieldErrors.nid}>
            <Input
              name="nid"
              className="num"
              defaultValue={member?.nid ?? ""}
            />
          </Field>
        </div>

        <SectionHeading>Contact</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone" error={fieldErrors.phone}>
            <Input
              name="phone"
              className="num"
              defaultValue={member?.phone ?? ""}
            />
          </Field>
          <Field
            label="Email"
            error={fieldErrors.personalEmail}
            hint="Their own address — this is the sheet's Email column"
          >
            <Input
              name="personalEmail"
              type="email"
              defaultValue={member?.personalEmail ?? ""}
            />
          </Field>
        </div>

        <Field
          label="Work email"
          error={fieldErrors.workEmail}
          hint="A company address, if they have one"
        >
          <Input
            name="workEmail"
            type="email"
            defaultValue={member?.workEmail ?? ""}
          />
        </Field>

        <Field label="Present address" error={fieldErrors.address}>
          <Textarea name="address" defaultValue={member?.address ?? ""} />
        </Field>

        <Field label="Permanent address" error={fieldErrors.permanentAddress}>
          <Textarea
            name="permanentAddress"
            defaultValue={member?.permanentAddress ?? ""}
          />
        </Field>

        <SectionHeading>Employment</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Designation" error={fieldErrors.designation}>
            <Input
              name="designation"
              defaultValue={member?.designation ?? ""}
            />
          </Field>
          <Field label="Department" error={fieldErrors.department}>
            <Input name="department" defaultValue={member?.department ?? ""} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Joined on" required error={fieldErrors.joinedOn}>
            <DateInput
              name="joinedOn"
              required
              defaultValue={member?.joinedOn ?? todayInDhaka()}
            />
          </Field>
          <Field
            label="Joining salary"
            error={fieldErrors.joiningSalary}
            hint="What was agreed at hire. Later raises go on the Pay tab, not here."
          >
            <MoneyInput
              name="joiningSalary"
              placeholder="45000.00"
              defaultValue={member?.joiningSalary ?? ""}
            />
          </Field>
        </div>

        {canSetPay && salaryNow !== null ? (
          <Field
            label="Current salary"
            error={fieldErrors.currentSalary}
            hint={
              editing
                ? "What they are paid now, monthly gross. Changing it writes a raise effective today, with the audit trail a raise gets. The Pay tab still holds the history."
                : "What they are paid now, monthly gross — this is what the directory and payroll read."
            }
          >
            <MoneyInput
              name="currentSalary"
              placeholder="45000.00"
              defaultValue={salaryNow}
            />
          </Field>
        ) : null}

        {editing ? (
          <Field label="Status">
            <Select name="status" defaultValue={member?.status}>
              {EMPLOYMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {EMPLOYMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {editing ? (
          <Field
            label="Last day"
            error={fieldErrors.endedOn}
            hint="Leave blank while they are still with you"
          >
            <DateInput name="endedOn" defaultValue={member?.endedOn ?? ""} />
          </Field>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Education" hint="The highest one finished">
            <Select
              name="educationLevel"
              defaultValue={member?.educationLevel ?? ""}
            >
              <option value="">Not set</option>
              {EDUCATION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {EDUCATION_LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Major"
            error={fieldErrors.educationMajor}
            hint="The subject — CSE, HRM, Psychology"
          >
            <Input
              name="educationMajor"
              defaultValue={member?.educationMajor ?? ""}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <PaperPick
            label="CV"
            hint="Uploads into the app when you save"
            accept="application/pdf,image/*"
            file={cvFile}
            stored={onFile?.cv}
            onPick={setCvFile}
            onPreview={preview.show}
          />
          <PaperPick
            label="Signed appointment letter"
            hint="Uploads into the app when you save"
            accept="application/pdf,image/*"
            file={letterFile}
            stored={onFile?.appointment_letter}
            onPick={setLetterFile}
            onPreview={preview.show}
          />
        </div>

        <SectionHeading>Tax &amp; bank</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="e-TIN"
            error={fieldErrors.etin}
            hint="Optional — 12 digits when there is one"
          >
            <Input
              name="etin"
              className="num"
              maxLength={12}
              defaultValue={member?.etin ?? ""}
            />
          </Field>
          <Field label="Assessment year" error={fieldErrors.psrAssessmentYear}>
            <Input
              name="psrAssessmentYear"
              className="num"
              placeholder="2026-2027"
              defaultValue={member?.psrAssessmentYear ?? ""}
            />
          </Field>
        </div>

        {/* PSR and the mobile wallet came off this drawer on the owner's
          instruction — payment outside a bank is not permitted, so a wallet
          number is a field for money that must not move, and the PSR line
          went with it. The columns stay in the database; existing values
          are simply no longer edited from here. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank" error={fieldErrors.bankName}>
            <Input name="bankName" defaultValue={member?.bankName ?? ""} />
          </Field>
          <Field label="Account number" error={fieldErrors.bankAccountNumber}>
            <Input
              name="bankAccountNumber"
              className="num"
              defaultValue={member?.bankAccountNumber ?? ""}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/*
            The name ON the account, which is not always the employee's own —
            a father's name, a joint account, a maiden name. A bank refuses a
            transfer whose beneficiary name does not match, so this is the
            field most likely to be the reason a salary bounced, and there was
            nowhere to record it.
          */}
          <Field
            label="Account holder"
            error={fieldErrors.bankAccountHolder}
            hint="The name on the account, if it is not theirs"
          >
            <Input
              name="bankAccountHolder"
              defaultValue={member?.bankAccountHolder ?? ""}
            />
          </Field>
          <Field label="Branch" error={fieldErrors.bankBranch}>
            <Input name="bankBranch" defaultValue={member?.bankBranch ?? ""} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Routing" error={fieldErrors.bankRouting}>
            <Input
              name="bankRouting"
              className="num"
              defaultValue={member?.bankRouting ?? ""}
            />
          </Field>
          <Field
            label="SWIFT / BIC"
            error={fieldErrors.bankSwift}
            hint="8 or 11 characters — needed when a salary is paid from abroad"
          >
            <Input
              name="bankSwift"
              className="num uppercase"
              maxLength={11}
              placeholder="SCBLBDDX"
              defaultValue={member?.bankSwift ?? ""}
            />
          </Field>
        </div>

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" defaultValue={member?.notes ?? ""} />
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
          form="member-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Add"}
        </Button>
      </div>

      {/*
        Inside the drawer, and above it: the viewer sets its own z-index, so a
        document opened from a picker lands over the drawer rather than behind
        it — which is what "click korlei okhanei" has to mean to be any use.
      */}
      {preview.overlay}
    </Drawer>
  );
}

/** Same group label the team list uses above each table. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-2 border-t border-border pt-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/**
 * One paper on the drawer: pick it now, it uploads after the save.
 *
 * Deliberately not a URL box. These lived as Drive links and the owner's rule
 * is that every paper lives inside the app — so the drawer takes the file
 * itself, and the profile's Documents card is where it appears (and where old
 * files are listed, replaced or removed).
 */
function PaperPick({
  label,
  hint,
  accept,
  file,
  stored,
  onPick,
  onPreview,
}: {
  label: string;
  hint?: string;
  accept: string;
  /** Chosen in the browser, not yet uploaded. */
  file: File | null;
  /** Already saved against this person, if anything is. */
  stored?: Stored;
  onPick: (file: File | null) => void;
  onPreview: (item: File | Stored) => void;
}) {
  /*
   * Three states, and the middle one is the one that was missing:
   *
   *   nothing on file              "Choose a file"
   *   something on file            its name, openable, and choosing replaces it
   *   something chosen just now    its name, openable, and clearable
   *
   * Both of the last two get the same eye, because "can I check this is the
   * right scan" is the same question whether the file arrived a second ago or
   * last year, and answering it should never require saving first.
   */
  const showing = file ?? stored ?? null;
  const name = file ? file.name : (stored?.name ?? null);

  return (
    <Field label={label} hint={showing ? undefined : hint}>
      <div className="flex items-center gap-2">
        <label className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 text-sm text-muted-foreground transition hover:text-foreground">
          <Paperclip className="size-3.5 shrink-0" />
          {name ? (
            <span className="max-w-48 truncate text-foreground">{name}</span>
          ) : (
            "Choose a file"
          )}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </label>

        {/*
          A stored photograph shows itself. "Current photo" as words answers
          "is there one" and not "is it the right one", and the second is the
          question somebody opening this drawer is actually asking.
        */}
        {!file && stored?.isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stored.href}
            alt={stored.name}
            className="size-9 shrink-0 rounded object-cover"
          />
        ) : null}

        {showing ? (
          <PreviewButton
            name={name ?? label}
            onClick={() => onPreview(showing)}
          />
        ) : null}

        {file ? (
          <button
            type="button"
            aria-label={`Remove the chosen ${label.toLowerCase()}`}
            onClick={() => onPick(null)}
            className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition hover:text-negative"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/*
        Said plainly rather than implied by the file name alone: a name in the
        box could be either the stored paper or the one about to replace it,
        and uploading the wrong thing over somebody's appointment letter is not
        a mistake that undoes itself.
      */}
      {stored && !file ? (
        <p className="mt-1 text-xs text-muted-foreground">
          On file. Choosing another adds a new one — the old stays on the
          profile.
        </p>
      ) : null}
      {stored && file ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Replaces nothing: {stored.name} stays on the profile too.
        </p>
      ) : null}
    </Field>
  );
}
