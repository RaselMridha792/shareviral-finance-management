"use client";

import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Printer } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { ProofControls } from "@/components/payroll/payment-proof-cell";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Input, Select } from "@/components/ui/field";
import { RowDetails, type DetailItem } from "@/components/ui/row-details";
import { ApiError } from "@/lib/api-client";
import { ledgerApi } from "@/lib/ledger";
import { payrollApi, rateOf, type PayrollLineDto } from "@/lib/payroll";
import { formatDate } from "@/lib/utils";

const money = (value: string | null | undefined) =>
  value === null || value === undefined ? null : (
    <Amount value={value} tone="neutral" showCounterpart={false} />
  );

/**
 * One person's line on the salary sheet, whole — opened by a click on the row
 * (the owner, 28 Oct 2026).
 *
 * The sheet now shows Basic and nothing else of the split; House Rent, Medical
 * and Conveyance are here. The figures are edited here too, but only while
 * the sheet is a draft: a finalised sheet is locked on the server, and this
 * says so instead of offering boxes it would refuse.
 *
 * Three things stay open after the lock, because none of them is a salary
 * figure: the Check (a review mark), the bank's fee for the transfer and the
 * screenshot that proves it — both of which only exist once the line is paid.
 */
export function LineDetails({
  line,
  daysInMonth,
  editable,
  onClose,
  onSaved,
}: {
  line: PayrollLineDto | null;
  daysInMonth: number;
  /** A draft sheet and somebody who may change it. */
  editable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!line) return null;

  if (editing && editable) {
    return (
      <LineEditor
        line={line}
        daysInMonth={daysInMonth}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onSaved();
        }}
      />
    );
  }

  return (
    <LineView
      line={line}
      daysInMonth={daysInMonth}
      editable={editable}
      onClose={onClose}
      onEdit={() => setEditing(true)}
      onSaved={onSaved}
    />
  );
}

function LineView({
  line,
  daysInMonth,
  editable,
  onClose,
  onEdit,
  onSaved,
}: {
  line: PayrollLineDto;
  daysInMonth: number;
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const canCheck = useCan("payroll.write");
  const rate = rateOf(line);
  const parts: DetailItem[] = (line.earningsBreakdown ?? []).map((part) => ({
    label: part.label,
    value: money(part.amount),
  }));

  return (
    <RowDetails
      open
      onClose={onClose}
      title={line.fullName}
      description={[line.snapshotDesignation, line.snapshotDepartment]
        .filter(Boolean)
        .join(" · ")}
      sections={[
        {
          title: "Pay",
          items: [
            ...parts,
            { label: "Bonus", value: money(line.bonusAmount) },
            { label: "Other +", value: money(line.otherAdditions) },
            {
              label: "Working days",
              value: `${line.workingDays ?? daysInMonth} of ${daysInMonth}`,
            },
            { label: "Gross", value: money(line.grossAmount) },
            { label: "TDS", value: money(line.tdsAmount) },
            {
              label: "Other −",
              value: line.deductionNote ? (
                <>
                  {money(line.otherDeductions)}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {line.deductionNote}
                  </span>
                </>
              ) : (
                money(line.otherDeductions)
              ),
            },
            { label: "Net Pay", value: money(line.netAmount) },
            {
              label: "FX rate",
              /* 122.450000 is the column's scale; 122.45 is the rate. */
              value:
                (line.fxRate ?? line.paidUsdRate)
                  ? String(Number(line.fxRate ?? line.paidUsdRate))
                  : null,
            },
            {
              label: "Net Pay (USD)",
              value: rate
                ? `≈ $${(Number(line.netAmount) / rate).toFixed(2)}`
                : null,
            },
          ],
        },
        {
          title: "Payment",
          items: [
            {
              label: "Paid on",
              value: line.paidOn ? formatDate(line.paidOn) : null,
            },
            {
              label: "Transaction fee",
              value: <FeeEditor line={line} onSaved={onSaved} />,
            },
            {
              label: "Reference",
              value: (
                <div className="flex justify-end">
                  <ProofControls line={line} onChanged={onSaved} />
                </div>
              ),
            },
            {
              label: "Check",
              value: (
                <CheckSelect
                  line={line}
                  disabled={!canCheck}
                  onSaved={onSaved}
                />
              ),
            },
            {
              label: "Payslip",
              value: line.isPaid ? (
                <Link
                  href={`/payroll/${line.id}/payslip`}
                  prefetch={false}
                  className="inline-flex items-center gap-1 text-link underline decoration-link/40 underline-offset-2"
                >
                  <Printer className="size-3.5" />
                  Open
                </Link>
              ) : null,
            },
          ],
        },
      ]}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {editable
              ? "The figures can be changed while the sheet is a draft."
              : "The sheet is finalised: reopen it to change a figure."}
          </span>
          {editable ? (
            <Button variant="secondary" size="md" onClick={onEdit}>
              <PencilSimpleIcon weight="duotone" size={17} />
              Edit
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

/** Checked or Unchecked, saved on change. */
export function CheckSelect({
  line,
  disabled,
  onSaved,
}: {
  line: PayrollLineDto;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Select
        aria-label={`Check for ${line.fullName}`}
        value={line.checked ? "checked" : "unchecked"}
        disabled={disabled || pending}
        className="h-8 w-auto py-0 text-[13px]"
        onChange={async (event) => {
          setPending(true);
          setError(null);
          try {
            await payrollApi.setLineChecked(
              line.id,
              event.target.value === "checked",
            );
            onSaved();
          } catch (caught) {
            setError(
              caught instanceof ApiError ? caught.message : "Could not save.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        <option value="unchecked">Unchecked</option>
        <option value="checked">Checked</option>
      </Select>
      {error ? (
        <span className="text-xs font-normal text-negative">{error}</span>
      ) : null}
    </span>
  );
}

/**
 * The bank's fee for this person's transfer, as the charge on the payment.
 *
 * Written through the payment's own edit (`chargeAmount`), the one door every
 * bank charge in the app goes through — so it is a real money-out row, in
 * Bank status's Fee and the account's balance, one per person (the owner,
 * 28 Oct 2026). Emptying it, or 0, takes the charge off.
 */
function FeeEditor({
  line,
  onSaved,
}: {
  line: PayrollLineDto;
  onSaved: () => void;
}) {
  const canWrite = useCan("transactions.write");
  const [value, setValue] = useState(
    line.feeAmount && Number(line.feeAmount) !== 0 ? line.feeAmount : "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!line.isPaid || !line.transactionId) return null;
  if (!canWrite) return money(line.feeAmount);

  const stored =
    line.feeAmount && Number(line.feeAmount) !== 0 ? line.feeAmount : "";
  const changed = value.trim() !== stored;

  async function save() {
    if (!line.transactionId) return;
    setPending(true);
    setError(null);
    try {
      await ledgerApi.update(line.transactionId, {
        chargeAmount: value.trim() === "" ? "0" : value.trim(),
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-2">
        <Input
          aria-label={`Transaction fee for ${line.fullName}`}
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="num h-8 w-28 py-0 text-right text-[13px]"
        />
        {changed ? (
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => void save()}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </span>
      {error ? (
        <span className="max-w-60 text-right text-xs font-normal text-negative">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The line's figures, as a form. Each changed box is saved through the same
 * `updateLine` the sheet's own cells use, one at a time and in the order the
 * server works them out — days first (they re-figure the gross), the net
 * last (a typed net sets itself over the arithmetic).
 */
function LineEditor({
  line,
  daysInMonth,
  onClose,
  onSaved,
}: {
  line: PayrollLineDto;
  daysInMonth: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = {
    workingDays: String(line.workingDays ?? daysInMonth),
    grossAmount: line.grossAmount,
    bonusAmount: line.bonusAmount,
    otherAdditions: line.otherAdditions,
    tdsAmount: line.tdsAmount,
    otherDeductions: line.otherDeductions,
    netAmount: line.netAmount,
    fxRate: line.fxRate ?? "",
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key: keyof typeof initial) =>
      String(data.get(key) ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const days = read("workingDays");
      if (days !== initial.workingDays) {
        await payrollApi.updateLine(line.id, {
          workingDays:
            days === "" || Number(days) === daysInMonth ? null : Number(days),
        });
      }
      for (const key of [
        "grossAmount",
        "bonusAmount",
        "otherAdditions",
        "tdsAmount",
        "otherDeductions",
      ] as const) {
        if (read(key) !== initial[key]) {
          await payrollApi.updateLine(line.id, { [key]: read(key) });
        }
      }
      if (read("fxRate") !== initial.fxRate) {
        await payrollApi.updateLine(line.id, {
          fxRate: read("fxRate") === "" ? null : read("fxRate"),
        });
      }
      if (read("netAmount") !== initial.netAmount) {
        await payrollApi.updateLine(line.id, {
          netAmount: read("netAmount") === "" ? null : read("netAmount"),
        });
      }
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setPending(false);
    }
  }

  const box = (key: keyof typeof initial, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        name={key}
        defaultValue={initial[key]}
        inputMode="decimal"
        className="num text-right"
      />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Edit — ${line.fullName}`}
      description="The sheet is a draft, so its figures can still change."
      footer={
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-negative">{error}</p>
          ) : (
            <span className="text-xs text-muted-foreground">
              Changing the gross re-figures its parts and the tax.
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              form="line-editor"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="line-editor"
        onSubmit={onSubmit}
        className="grid grid-cols-2 gap-4"
      >
        {box("workingDays", "Working days", `of ${daysInMonth}`)}
        {box("grossAmount", "Gross")}
        {box("bonusAmount", "Bonus")}
        {box("otherAdditions", "Other +")}
        {box("tdsAmount", "TDS")}
        {box("otherDeductions", "Other −")}
        {box("netAmount", "Net Pay", "Typed over, it is the figure")}
        {box("fxRate", "FX rate", "Empty means none stated")}
      </form>
    </Drawer>
  );
}
