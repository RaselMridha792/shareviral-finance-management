"use client";

import {
  BLOOD_GROUPS,
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_TYPES,
  GENDERS,
  GENDER_LABELS,
  PSR_STATUSES,
  PSR_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { ApiError } from "@/lib/api-client";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";

/**
 * Enums on the API side, where "" is not a valid answer. An unanswered one is
 * left out of the request rather than sent empty.
 */
const OMIT_WHEN_BLANK = ["gender", "bloodGroup", "educationLevel"] as const;

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

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
      engagementType: text("engagementType"),
      department: text("department"),
      designation: text("designation"),
      joinedOn: text("joinedOn"),
      personalEmail: text("personalEmail"),
      workEmail: text("workEmail"),
      phone: text("phone"),
      nid: text("nid"),
      etin: text("etin"),
      psrStatus: text("psrStatus"),
      psrAssessmentYear: text("psrAssessmentYear"),
      bankName: text("bankName"),
      bankAccountNumber: text("bankAccountNumber"),
      bankRouting: text("bankRouting"),
      walletProvider: text("walletProvider"),
      walletNumber: text("walletNumber"),
      address: text("address"),
      notes: text("notes"),
      photoUrl: text("photoUrl"),
      dateOfBirth: text("dateOfBirth"),
      permanentAddress: text("permanentAddress"),
      // The offer figure, not payroll. Raises are set on the Pay tab, which
      // this drawer cannot reach and HR cannot open.
      joiningSalary: text("joiningSalary"),
      educationMajor: text("educationMajor"),
      cvUrl: text("cvUrl"),
      appointmentLetterUrl: text("appointmentLetterUrl"),
      ...(editing ? { status: text("status"), endedOn: text("endedOn") } : {}),
    } as Parameters<typeof teamApi.create>[0];

    for (const key of OMIT_WHEN_BLANK) {
      const value = text(key);
      if (value) (payload as Record<string, unknown>)[key] = value;
    }

    try {
      if (member) await teamApi.update(member.id, payload);
      else await teamApi.create(payload);
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
          <Field label="Type" required>
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
        </div>

        <Field label="Full name" required error={fieldErrors.fullName}>
          <Input name="fullName" required defaultValue={member?.fullName} />
        </Field>

        <Field
          label="Photo"
          error={fieldErrors.photoUrl}
          hint="A link, not an upload — a Drive file or any https:// address"
        >
          <Input
            name="photoUrl"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…"
            defaultValue={member?.photoUrl ?? ""}
          />
        </Field>

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

        <Field
          label="CV"
          error={fieldErrors.cvUrl}
          hint="A link, not an upload — a Drive file or any https:// address"
        >
          <Input
            name="cvUrl"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…"
            defaultValue={member?.cvUrl ?? ""}
          />
        </Field>

        <Field
          label="Signed appointment letter"
          error={fieldErrors.appointmentLetterUrl}
          hint="A link, not an upload — a Drive file or any https:// address"
        >
          <Input
            name="appointmentLetterUrl"
            type="url"
            inputMode="url"
            placeholder="https://drive.google.com/…"
            defaultValue={member?.appointmentLetterUrl ?? ""}
          />
        </Field>

        <SectionHeading>Tax &amp; bank</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="e-TIN" error={fieldErrors.etin} hint="12 digits">
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

        <Field
          label="Return filed (PSR)"
          hint="Required above ৳16,000 basic a month"
        >
          <Select
            name="psrStatus"
            defaultValue={member?.psrStatus ?? "unknown"}
          >
            {PSR_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PSR_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

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
          <Field label="Routing" error={fieldErrors.bankRouting}>
            <Input
              name="bankRouting"
              className="num"
              defaultValue={member?.bankRouting ?? ""}
            />
          </Field>
          <Field label="Mobile wallet" error={fieldErrors.walletNumber}>
            <Input
              name="walletNumber"
              className="num"
              placeholder="bKash / Nagad number"
              defaultValue={member?.walletNumber ?? ""}
            />
          </Field>
        </div>

        <input
          type="hidden"
          name="walletProvider"
          defaultValue={member?.walletProvider ?? ""}
        />

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
