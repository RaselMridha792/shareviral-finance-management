"use client";

import {
  PSR_STATUSES,
  PSR_STATUS_LABELS,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { vendorsApi, type VendorDto } from "@/lib/masters";

export function VendorForm({
  open,
  vendor,
  onClose,
  onSaved,
}: {
  open: boolean;
  vendor?: VendorDto;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const editing = Boolean(vendor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(
      [
        "name",
        "type",
        "etin",
        "bin",
        "psrStatus",
        "psrAssessmentYear",
        "psrReference",
        "contactName",
        "phone",
        "email",
        "address",
        "notes",
      ].map((key) => [key, String(data.get(key) ?? "")]),
    ) as Parameters<typeof vendorsApi.create>[0];

    try {
      if (vendor) {
        await vendorsApi.update(vendor.id, payload);
      } else {
        await vendorsApi.create(payload);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save. Check the API is running.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit vendor" : "Add a vendor"}
      description="Tax identifiers matter: without a filed return the TDS rate rises by half."
    >
      <form
        id="vendor-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={fieldErrors.name}>
          <Input name="name" defaultValue={vendor?.name} required autoFocus />
        </Field>

        <Field label="Type" required>
          <Select name="type" defaultValue={vendor?.type ?? "supplier"}>
            {VENDOR_TYPES.map((type) => (
              <option key={type} value={type}>
                {VENDOR_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="e-TIN" error={fieldErrors.etin} hint="12 digits">
            <Input
              name="etin"
              className="num"
              inputMode="numeric"
              maxLength={12}
              defaultValue={vendor?.etin ?? ""}
            />
          </Field>
          <Field label="BIN" error={fieldErrors.bin} hint="13 digits, VAT">
            <Input
              name="bin"
              className="num"
              inputMode="numeric"
              maxLength={13}
              defaultValue={vendor?.bin ?? ""}
            />
          </Field>
        </div>

        <Field
          label="Return filed (PSR)"
          hint="Not filed means TDS is deducted at 1.5× the normal rate"
        >
          <Select
            name="psrStatus"
            defaultValue={vendor?.psrStatus ?? "unknown"}
          >
            {PSR_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PSR_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Assessment year"
            error={fieldErrors.psrAssessmentYear}
            hint="e.g. 2026-2027"
          >
            <Input
              name="psrAssessmentYear"
              className="num"
              placeholder="2026-2027"
              defaultValue={vendor?.psrAssessmentYear ?? ""}
            />
          </Field>
          <Field label="PSR reference" error={fieldErrors.psrReference}>
            <Input
              name="psrReference"
              className="num"
              defaultValue={vendor?.psrReference ?? ""}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name" error={fieldErrors.contactName}>
            <Input
              name="contactName"
              defaultValue={vendor?.contactName ?? ""}
            />
          </Field>
          <Field label="Phone" error={fieldErrors.phone}>
            <Input
              name="phone"
              className="num"
              defaultValue={vendor?.phone ?? ""}
            />
          </Field>
        </div>

        <Field label="Email" error={fieldErrors.email}>
          <Input name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>

        <Field label="Address" error={fieldErrors.address}>
          <Textarea name="address" defaultValue={vendor?.address ?? ""} />
        </Field>

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" defaultValue={vendor?.notes ?? ""} />
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
          form="vendor-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Add vendor"}
        </Button>
      </div>
    </Drawer>
  );
}
