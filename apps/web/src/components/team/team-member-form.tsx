"use client";

import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  ENGAGEMENT_TYPES,
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
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { teamApi, type TeamMemberDto } from "@/lib/payroll";

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
      ...(editing
        ? { status: text("status"), endedOn: text("endedOn") }
        : {}),
    } as Parameters<typeof teamApi.create>[0];

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
      description="Pay is recorded separately, on the Compensation tab."
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Designation" error={fieldErrors.designation}>
            <Input name="designation" defaultValue={member?.designation ?? ""} />
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="NID" error={fieldErrors.nid}>
            <Input name="nid" className="num" defaultValue={member?.nid ?? ""} />
          </Field>
          <Field label="e-TIN" error={fieldErrors.etin} hint="12 digits">
            <Input
              name="etin"
              className="num"
              maxLength={12}
              defaultValue={member?.etin ?? ""}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <Field label="Assessment year" error={fieldErrors.psrAssessmentYear}>
            <Input
              name="psrAssessmentYear"
              className="num"
              placeholder="2026-2027"
              defaultValue={member?.psrAssessmentYear ?? ""}
            />
          </Field>
        </div>

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

        <Field label="Address" error={fieldErrors.address}>
          <Textarea name="address" defaultValue={member?.address ?? ""} />
        </Field>

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
