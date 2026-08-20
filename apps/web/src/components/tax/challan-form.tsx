"use client";

import { todayInDhaka } from "@finance/shared";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError, fileHref, type StoredFile } from "@/lib/api-client";
import { listChallanFiles, tdsApi, uploadChallanFile } from "@/lib/tax";
import type { TdsDepositDto } from "@/lib/tax";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Recording a challan, and correcting one.
 *
 * One form for both, for the reason the cash-in screen ended up with one form:
 * a correction that asks different questions from the record means the fields
 * somebody most needs to fix are the ones they cannot reach.
 *
 * The scan uploads immediately rather than on save, because a file needs a row
 * to hang on. When recording, the challan is written first and the file
 * attached to what came back; when correcting, the row already exists.
 */
export function ChallanForm({
  open,
  deposit,
  year,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The challan being corrected, or nothing when one is being recorded. */
  deposit?: TdsDepositDto;
  year: number;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const editing = Boolean(deposit);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [scan, setScan] = useState<StoredFile | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // What is already attached, so the drawer can say so rather than offering to
  // upload a second one over the top of it.
  useEffect(() => {
    if (!open || !deposit) return;
    let cancelled = false;
    void listChallanFiles(deposit.id)
      .then((files) => {
        if (!cancelled) setScan(files[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, deposit]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? undefined : value;
    };

    try {
      const body = {
        challanNumber: String(data.get("challanNumber")).trim(),
        challanDate: String(data.get("challanDate")),
        depositDate: String(data.get("depositDate")),
        amount: String(data.get("amount")).trim(),
        bankName: text("bankName"),
        branch: text("branch"),
        periodYear: Number(data.get("periodYear")),
        periodMonth: Number(data.get("periodMonth")),
        notes: text("notes"),
      };

      const row = deposit
        ? await tdsApi.updateDeposit(deposit.id, body)
        : await tdsApi.createDeposit({ ...body, depositType: "salary" });

      // After the row exists, never before: a file has to hang on something.
      if (chosen) {
        try {
          await uploadChallanFile(row.id, chosen);
        } catch {
          // The challan is saved. Saying "could not save" here would be false,
          // and would send somebody back to type it again.
          await onSaved(
            `Challan ${row.challanNumber} saved, but the scan did not upload.`,
          );
          onClose();
          return;
        }
      }

      await onSaved(
        editing
          ? `Challan ${row.challanNumber} corrected.`
          : `Challan ${row.challanNumber} recorded.`,
      );
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
      title={editing ? "Correct a challan" : "Record a challan"}
      description={
        editing
          ? "The bank's receipt for tax already deposited."
          : "What the bank took, against the tax withheld from the salary sheet."
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        <Field
          label="Challan number"
          required
          error={fieldErrors.challanNumber}
          hint="As it appears on the A-Challan"
        >
          <Input
            name="challanNumber"
            defaultValue={deposit?.challanNumber}
            placeholder="A-2026071142"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Challan date" required error={fieldErrors.challanDate}>
            <Input
              type="date"
              name="challanDate"
              defaultValue={deposit?.challanDate ?? todayInDhaka()}
              required
            />
          </Field>
          <Field
            label="Deposit date"
            required
            error={fieldErrors.depositDate}
            hint="When the money left"
          >
            <Input
              type="date"
              name="depositDate"
              defaultValue={deposit?.depositDate ?? todayInDhaka()}
              required
            />
          </Field>
        </div>

        <Field label="Amount" required error={fieldErrors.amount}>
          <MoneyInput name="amount" defaultValue={deposit?.amount} required />
        </Field>

        {/*
          Which month's deductions this settles — not the month it was paid in.
          The deadline is counted from the first, and a challan filed against
          the wrong period is how a late deposit looks on time.
        */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tax withheld in" required>
            <Select
              name="periodMonth"
              defaultValue={deposit?.periodMonth ?? new Date().getMonth() + 1}
            >
              {MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" required>
            <Input
              type="number"
              name="periodYear"
              defaultValue={deposit?.periodYear ?? year}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank" error={fieldErrors.bankName}>
            <Input
              name="bankName"
              defaultValue={deposit?.bankName ?? undefined}
              placeholder="Sonali Bank"
            />
          </Field>
          <Field label="Branch" error={fieldErrors.branch}>
            <Input name="branch" defaultValue={deposit?.branch ?? undefined} />
          </Field>
        </div>

        {/* --- the scan ------------------------------------------------- */}
        <Field
          label="Challan scan"
          hint="A photo or the PDF the bank gave you. This is what somebody clicks the challan number to see."
        >
          <div className="flex flex-col gap-2">
            {scan && !chosen ? (
              <span className="flex items-center gap-2 text-sm">
                <Paperclip className="size-3.5 text-muted-foreground" />
                <a
                  href={`${fileHref(scan.id)}?inline=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary-text underline-offset-2 hover:underline"
                >
                  {scan.originalName}
                </a>
                <span className="text-xs text-muted-foreground">
                  — choosing another replaces it
                </span>
              </span>
            ) : null}

            {chosen ? (
              <span className="flex items-center gap-2 text-sm">
                <Paperclip className="size-3.5 text-muted-foreground" />
                {chosen.name}
                <button
                  type="button"
                  onClick={() => {
                    setChosen(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  aria-label="Remove the chosen file"
                  className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-negative"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ) : null}

            <label className="cursor-pointer">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="sr-only"
                onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
              />
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-muted">
                <Paperclip className="size-3.5" />
                {scan || chosen ? "Choose another" : "Attach the scan"}
              </span>
            </label>
          </div>
        </Field>

        <Field label="Note" error={fieldErrors.notes}>
          <Textarea name="notes" defaultValue={deposit?.notes ?? undefined} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {editing ? "Save the correction" : "Record it"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
