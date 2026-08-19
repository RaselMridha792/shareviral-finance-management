"use client";

import {
  USUAL_DEDUCTIONS,
  USUAL_EARNINGS,
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
} from "@finance/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import {
  payrollApi,
  type PayrollLineDto,
  type PayslipLineDto,
} from "@/lib/payroll";
import { cn } from "@/lib/utils";

/**
 * What the payslip prints in the middle, and how many days were paid for.
 *
 * A panel rather than more columns on the salary sheet: the sheet is a grid
 * somebody scans across twenty people, and a five-line earnings split does not
 * belong in a cell. This is opened for one person at a time, which is also how
 * the question arises — "why is Farhana's gross made up like that".
 *
 * The totals are not edited here. `grossAmount` on the sheet is what was paid
 * and stays the authority; this describes it. The panel shows when the two
 * disagree rather than refusing to save, because a mid-month raise legitimately
 * produces a split that does not add to the month's gross, and refusing would
 * make the app unusable in exactly the month somebody needs it.
 */
export function BreakdownDrawer({
  line,
  currency,
  numberFormat,
  open,
  onClose,
  onSaved,
}: {
  line: PayrollLineDto;
  currency: string;
  numberFormat: "bangladeshi" | "western";
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [earnings, setEarnings] = useState<PayslipLineDto[]>(
    line.earningsBreakdown ?? [],
  );
  const [deductions, setDeductions] = useState<PayslipLineDto[]>(
    line.deductionsBreakdown ?? [],
  );
  const [paidDays, setPaidDays] = useState(line.paidDays?.toString() ?? "");
  const [workingDays, setWorkingDays] = useState(
    line.workingDays?.toString() ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (value: string) =>
    formatMoney(value, { currency, format: numberFormat });

  const grossPaid = sum([
    line.grossAmount,
    line.bonusAmount,
    line.otherAdditions,
  ]);
  // The tax is not part of what is described here — the app works it out and
  // the payslip adds it as its own line. What this side has to account for is
  // the rest: advances, unpaid leave, anything typed on the sheet.
  const deductionsPaid = line.otherDeductions;

  async function onSave() {
    setPending(true);
    setError(null);
    try {
      await payrollApi.updateLine(line.id, {
        // `null` clears a breakdown back to "just the gross", which is not the
        // same as leaving the field out and keeping what is there.
        earningsBreakdown: clean(earnings),
        deductionsBreakdown: clean(deductions),
        paidDays: paidDays === "" ? null : Number(paidDays),
        workingDays: workingDays === "" ? null : Number(workingDays),
      });
      onSaved();
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
      title={`${line.fullName} — payslip breakdown`}
      description="How the gross and the deductions are made up on the printed slip"
      footer={
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-negative">{error}</p>
          ) : (
            <span className="text-xs text-muted-foreground">
              The totals on the salary sheet do not change.
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={onSave}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid days" hint="Leave both empty for a full month">
            <Input
              className="num"
              inputMode="numeric"
              value={paidDays}
              onChange={(e) => setPaidDays(e.target.value.replace(/\D/g, ""))}
              placeholder="24"
            />
          </Field>
          <Field label="Working days">
            <Input
              className="num"
              inputMode="numeric"
              value={workingDays}
              onChange={(e) =>
                setWorkingDays(e.target.value.replace(/\D/g, ""))
              }
              placeholder="26"
            />
          </Field>
        </section>

        <Side
          heading="Earnings"
          rows={earnings}
          setRows={setEarnings}
          usual={USUAL_EARNINGS}
          target={grossPaid}
          targetLabel="Gross on the sheet"
          money={money}
        />

        <Side
          heading="Deductions"
          rows={deductions}
          setRows={setDeductions}
          usual={USUAL_DEDUCTIONS}
          target={deductionsPaid}
          targetLabel="Other deductions on the sheet"
          note="Tax is worked out by the app and added to the payslip on its own line — leave it out of this list."
          money={money}
        />
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */

function Side({
  heading,
  rows,
  setRows,
  usual,
  target,
  targetLabel,
  note,
  money,
}: {
  heading: string;
  rows: PayslipLineDto[];
  setRows: (rows: PayslipLineDto[]) => void;
  usual: readonly string[];
  target: string;
  targetLabel: string;
  note?: string;
  money: (value: string) => string;
}) {
  const total = sum(rows.map((row) => row.amount || "0"));
  const matches = toMinorUnits(total) === toMinorUnits(target);

  function update(index: number, patch: Partial<PayslipLineDto>) {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{heading}</h3>
        {rows.length === 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setRows(usual.map((label) => ({ label, amount: "0.00" })))
            }
          >
            Add the usual lines
          </Button>
        ) : null}
      </div>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          Nothing set. The payslip will show one line for the whole figure.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                aria-label={`${heading} line ${index + 1} name`}
                value={row.label}
                maxLength={60}
                placeholder="Basic Salary"
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <Input
                aria-label={`${heading} line ${index + 1} amount`}
                className="num w-36 text-right"
                inputMode="decimal"
                value={row.amount}
                placeholder="0.00"
                onChange={(e) =>
                  update(index, {
                    amount: e.target.value.replace(/[^\d.]/g, ""),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove ${row.label || `line ${index + 1}`}`}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                className="cursor-pointer rounded-md p-2 text-muted-foreground transition hover:bg-negative/10 hover:text-negative"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRows([...rows, { label: "", amount: "0.00" }])}
        >
          <Plus className="size-3.5" />
          Add a line
        </Button>

        {rows.length > 0 ? (
          <p
            className={cn(
              "num text-xs",
              matches ? "text-muted-foreground" : "text-warning",
            )}
          >
            {money(total)}
            {matches ? (
              <span className="ml-1.5">matches the sheet</span>
            ) : (
              <span className="ml-1.5">
                — {targetLabel} is {money(target)}
              </span>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What actually gets saved: named lines only.
 *
 * An empty row is somebody who clicked "Add a line" and changed their mind,
 * not a line called "". Dropping every row means `null` — no breakdown, which
 * the payslip prints as a single figure.
 */
function clean(rows: PayslipLineDto[]): PayslipLineDto[] | null {
  const kept = rows
    .map((row) => ({
      label: row.label.trim(),
      amount: row.amount.trim() === "" ? "0.00" : row.amount.trim(),
    }))
    .filter((row) => row.label !== "");
  return kept.length ? kept : null;
}

function sum(values: string[]): string {
  return fromMinorUnits(
    values.reduce(
      (total, value) => total + toMinorUnits(value || "0"),
      BigInt(0),
    ),
  );
}
