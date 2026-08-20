"use client";

import { LoaderCircle, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/field";
import { ApiError, fileHref, type StoredFile } from "@/lib/api-client";
import {
  listLineChallanFiles,
  setLineChallan,
  uploadLineChallanFile,
} from "@/lib/tax";

/**
 * The challan a person's withheld tax was deposited under.
 *
 * Two fields and a switch, and deliberately nothing else. The deposit's date,
 * bank and amount are the bank's own record and live on `tds_deposits`; asked
 * for again here they would be the same facts written twice, disagreeing by
 * next month. What the register is read for is narrower than that — which
 * challan settled this row, and where is the paper.
 *
 * The scan uploads after the number is saved, never before, for the reason the
 * documents drawer everywhere else has: a file has to hang on something. The
 * row already exists, so the order only matters when the save fails — and then
 * nothing has been attached to a number that was never written.
 */
export function LineChallanForm({
  open,
  line,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The row the pencil was pressed on. */
  line: {
    payrollLineId: string;
    fullName: string;
    periodLabel: string;
    challanNumber: string | null;
  } | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * On by default, because that is what a bank actually does: one A-Challan
   * settles the tax withheld from everybody that month. Off, this writes the
   * number on one person — which is the right answer when somebody's tax went
   * in on its own, and the wrong one twenty-four times otherwise.
   */
  const [applyToMonth, setApplyToMonth] = useState(true);

  const [scan, setScan] = useState<StoredFile | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /*
   * What this row already carries, so the drawer says so rather than offering
   * to upload a second copy over the top of it. Only this row's own file: the
   * table opens the scan by challan number, but replacing one is a change to
   * the row somebody has open.
   */
  useEffect(() => {
    if (!open || !line) return;
    let cancelled = false;
    void listLineChallanFiles(line.payrollLineId)
      .then((files) => {
        if (!cancelled) setScan(files[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, line]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!line) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const challanNumber = String(data.get("challanNumber") ?? "").trim();

    try {
      const result = await setLineChallan(line.payrollLineId, {
        challanNumber,
        applyToMonth,
      });

      if (chosen) {
        try {
          await uploadLineChallanFile(line.payrollLineId, chosen);
        } catch {
          // The number is saved. Saying "could not save" would be false, and
          // would send somebody back to type it again.
          await onSaved(
            `Challan ${result.challanNumber} recorded, but the file did not upload.`,
          );
          onClose();
          return;
        }
      }

      /*
       * What actually changed, counted by the server rather than assumed here.
       * "Saved" over a switch that quietly reached twenty-five rows is how
       * somebody finds out next month.
       */
      await onSaved(
        result.challanNumber
          ? result.rowsChanged > 1
            ? `Challan ${result.challanNumber} recorded on ${result.rowsChanged} rows for ${result.period}.`
            : `Challan ${result.challanNumber} recorded for ${line.fullName}.`
          : result.rowsChanged > 1
            ? `Challan cleared from ${result.rowsChanged} rows for ${result.period}.`
            : `Challan cleared from ${line.fullName}.`,
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
      open={open && Boolean(line)}
      onClose={onClose}
      title="Challan for this deduction"
      description={
        line
          ? `${line.fullName} — tax withheld in ${line.periodLabel}`
          : undefined
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
          error={fieldErrors.challanNumber}
          hint="As it appears on the A-Challan. Leave it empty to clear it."
        >
          <Input
            name="challanNumber"
            defaultValue={line?.challanNumber ?? ""}
            placeholder="A-2026071142"
            autoFocus
          />
        </Field>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={applyToMonth}
            onChange={(event) => setApplyToMonth(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Everybody taxed in {line?.periodLabel ?? "this month"}
            <span className="mt-0.5 block text-xs text-muted-foreground">
              One challan usually covers the whole month. Untick it to write
              this number on {line?.fullName ?? "this person"} alone.
            </span>
          </span>
        </label>

        {/* --- the scan ------------------------------------------------- */}
        <Field
          label="Challan file"
          hint={
            // Both facts in the one place a reader is already looking: what
            // may be attached, and that it is attached once for the month.
            "A photo, a screenshot or the PDF the bank gave you — attached once, and every row carrying this challan number opens it."
          }
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
                {scan || chosen ? "Choose another" : "Attach the file"}
              </span>
            </label>
          </div>
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
