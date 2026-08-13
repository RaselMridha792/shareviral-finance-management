"use client";

import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  PSR_STATUSES,
  PSR_STATUS_LABELS,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
  isRecurringType,
  todayInDhaka,
  type VendorType,
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
  // The billing fields only make sense for something that recurs, and a form
  // of empty boxes is a form people fill in wrongly. They appear when the type
  // says they should, or when this one already has a cycle set.
  const [type, setType] = useState<VendorType>(vendor?.type ?? "supplier");
  const [cycle, setCycle] = useState(vendor?.billingCycle ?? "none");
  const recurring = isRecurringType(type) || cycle !== "none";

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
        "billingCycle",
        "billingAmount",
        "billingCurrency",
        "nextRenewalOn",
      ].map((key) => [key, String(data.get(key) ?? "")]),
    ) as Parameters<typeof vendorsApi.create>[0];

    // An empty select is not a uuid, and the API would rather have nothing.
    const account = String(data.get("billingAccountId") ?? "");
    if (account) {
      (payload as Record<string, unknown>).billingAccountId = account;
    }

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
      title={editing ? "Edit" : "Add a subscription or vendor"}
      description="An AI tool, a subscription, or anyone else money is paid to. Tax identifiers matter for the latter: without a filed return the TDS rate rises by half."
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
          <Select
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value as VendorType)}
          >
            {VENDOR_TYPES.map((option) => (
              <option key={option} value={option}>
                {VENDOR_TYPE_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Renews">
            <Select
              name="billingCycle"
              value={cycle}
              onChange={(event) => setCycle(event.target.value as typeof cycle)}
            >
              {BILLING_CYCLES.map((option) => (
                <option key={option} value={option}>
                  {BILLING_CYCLE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          {recurring ? (
            <Field
              label="Billed in"
              hint="Most AI tools charge in dollars — say so and the totals stay honest"
            >
              <Select
                name="billingCurrency"
                defaultValue={vendor?.billingCurrency ?? "BDT"}
              >
                <option value="BDT">BDT</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          ) : null}
        </div>

        {recurring ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount each time" error={fieldErrors.billingAmount}>
              <Input
                name="billingAmount"
                inputMode="decimal"
                className="col-amount"
                placeholder="20.00"
                defaultValue={vendor?.billingAmount ?? ""}
              />
            </Field>
            <Field
              label="Next renewal"
              error={fieldErrors.nextRenewalOn}
              hint="Any past date works — it rolls forward on its own"
            >
              <Input
                name="nextRenewalOn"
                type="date"
                className="num"
                defaultValue={vendor?.nextRenewalOn ?? todayInDhaka()}
              />
            </Field>
          </div>
        ) : (
          <input type="hidden" name="billingCurrency" value="BDT" />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
