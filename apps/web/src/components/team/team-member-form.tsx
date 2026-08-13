"use client";

import {
  BLOOD_GROUPS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_TYPES,
  GENDERS,
  GENDER_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  PSR_STATUSES,
  PSR_STATUS_LABELS,
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
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";

/**
 * Enums and a uuid on the API side, where "" is not a valid answer. An
 * unanswered one is left out of the request rather than sent empty.
 */
const OMIT_WHEN_BLANK = [
  "gender",
  "maritalStatus",
  "bloodGroup",
  "reportingManagerId",
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // A spouse's name only means anything for someone married, and a box of
  // empty fields is a box people fill in wrongly. It appears when the status
  // says it should, or when a name is already on record.
  const [maritalStatus, setMaritalStatus] = useState<string>(
    member?.maritalStatus ?? "",
  );
  const married = maritalStatus === "married" || Boolean(member?.spouseName);

  // The manager is stored as an id, so the picker needs the directory. Fetched
  // when the panel opens; a controlled value keeps the right person selected
  // however late the list arrives.
  const [colleagues, setColleagues] = useState<TeamMemberDto[]>([]);
  const [managerId, setManagerId] = useState(member?.reportingManagerId ?? "");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void teamApi
      .list()
      .then((page) => {
        if (!cancelled) setColleagues(page.items);
      })
      // Without the list the field simply keeps whoever is already set.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const managerOptions = colleagues.filter((person) => person.id !== member?.id);
  const managerMissing =
    Boolean(managerId) && !managerOptions.some((person) => person.id === managerId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "");

    const payload = {
      employeeCode: text("employeeCode"),
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
      spouseName: text("spouseName"),
      fatherName: text("fatherName"),
      motherName: text("motherName"),
      religion: text("religion"),
      passportNumber: text("passportNumber"),
      permanentAddress: text("permanentAddress"),
      emergencyContactName: text("emergencyContactName"),
      emergencyContactRelation: text("emergencyContactRelation"),
      emergencyContactPhone: text("emergencyContactPhone"),
      probationUntil: text("probationUntil"),
      confirmedOn: text("confirmedOn"),
      lastQualification: text("lastQualification"),
      ...(editing
        ? { status: text("status"), endedOn: text("endedOn") }
        : {}),
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
      <form id="member-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" required error={fieldErrors.employeeCode}>
            <Input
              name="employeeCode"
              required
              className="num"
              placeholder="SV-001"
              defaultValue={member?.employeeCode}
            />
          </Field>
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
          <Field label="Marital status">
            <Select
              name="maritalStatus"
              value={maritalStatus}
              onChange={(event) => setMaritalStatus(event.target.value)}
            >
              <option value="">Not set</option>
              {MARITAL_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {MARITAL_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          {married ? (
            <Field label="Spouse's name" error={fieldErrors.spouseName}>
              <Input name="spouseName" defaultValue={member?.spouseName ?? ""} />
            </Field>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Father's name" error={fieldErrors.fatherName}>
            <Input name="fatherName" defaultValue={member?.fatherName ?? ""} />
          </Field>
          <Field label="Mother's name" error={fieldErrors.motherName}>
            <Input name="motherName" defaultValue={member?.motherName ?? ""} />
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
          <Field label="Religion" error={fieldErrors.religion}>
            <Input name="religion" defaultValue={member?.religion ?? ""} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="NID" error={fieldErrors.nid}>
            <Input name="nid" className="num" defaultValue={member?.nid ?? ""} />
          </Field>
          <Field label="Passport" error={fieldErrors.passportNumber}>
            <Input
              name="passportNumber"
              className="num"
              defaultValue={member?.passportNumber ?? ""}
            />
          </Field>
        </div>

        <SectionHeading>Contact</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone" error={fieldErrors.phone}>
            <Input name="phone" className="num" defaultValue={member?.phone ?? ""} />
          </Field>
          <Field label="Work email" error={fieldErrors.workEmail}>
            <Input name="workEmail" type="email" defaultValue={member?.workEmail ?? ""} />
          </Field>
        </div>

        <Field label="Personal email" error={fieldErrors.personalEmail}>
          <Input
            name="personalEmail"
            type="email"
            defaultValue={member?.personalEmail ?? ""}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Emergency contact"
            error={fieldErrors.emergencyContactName}
            hint="Who to call"
          >
            <Input
              name="emergencyContactName"
              defaultValue={member?.emergencyContactName ?? ""}
            />
          </Field>
          <Field label="Relation" error={fieldErrors.emergencyContactRelation}>
            <Input
              name="emergencyContactRelation"
              placeholder="Father, spouse, brother"
              defaultValue={member?.emergencyContactRelation ?? ""}
            />
          </Field>
        </div>

        <Field label="Emergency phone" error={fieldErrors.emergencyContactPhone}>
          <Input
            name="emergencyContactPhone"
            className="num"
            defaultValue={member?.emergencyContactPhone ?? ""}
          />
        </Field>

        <SectionHeading>Employment</SectionHeading>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Designation" error={fieldErrors.designation}>
            <Input name="designation" defaultValue={member?.designation ?? ""} />
          </Field>
          <Field label="Department" error={fieldErrors.department}>
            <Input name="department" defaultValue={member?.department ?? ""} />
          </Field>
        </div>

        <Field label="Reports to" error={fieldErrors.reportingManagerId}>
          <Select
            name="reportingManagerId"
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
          >
            <option value="">No one</option>
            {managerMissing ? (
              <option value={managerId}>Whoever is set now</option>
            ) : null}
            {managerOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName} ({person.employeeCode})
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Joined on" required error={fieldErrors.joinedOn}>
            <DateInput
              name="joinedOn"
              required
              defaultValue={member?.joinedOn ?? todayInDhaka()}
            />
          </Field>
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
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Probation until" error={fieldErrors.probationUntil}>
            <DateInput
              name="probationUntil"
              defaultValue={member?.probationUntil ?? ""}
            />
          </Field>
          <Field label="Confirmed on" error={fieldErrors.confirmedOn}>
            <DateInput
              name="confirmedOn"
              defaultValue={member?.confirmedOn ?? ""}
            />
          </Field>
        </div>

        {editing ? (
          <Field
            label="Last day"
            error={fieldErrors.endedOn}
            hint="Leave blank while they are still with you"
          >
            <DateInput name="endedOn" defaultValue={member?.endedOn ?? ""} />
          </Field>
        ) : null}

        <Field
          label="Last qualification"
          error={fieldErrors.lastQualification}
          hint="The highest one finished — BSc in CSE, HSC"
        >
          <Input
            name="lastQualification"
            defaultValue={member?.lastQualification ?? ""}
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
          <Select name="psrStatus" defaultValue={member?.psrStatus ?? "unknown"}>
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
        <Button type="submit" form="member-form" variant="primary" disabled={pending}>
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
