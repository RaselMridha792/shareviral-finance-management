"use client";

import {
  PAYMENT_MODES,
  PAYMENT_MODE_LABELS,
  PAYROLL_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import {
  ArrowLeft,
  CircleCheck,
  LoaderCircle,
  Lock,
  Printer,
  RefreshCw,
  TriangleAlert,
  Unlock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import type { AccountDto } from "@/lib/masters";
import { payrollApi, type PayrollLineDto, type PayrollRunDto } from "@/lib/payroll";
import { cn } from "@/lib/utils";

export function SalarySheetScreen({
  run,
  lines,
  accounts,
}: {
  run: PayrollRunDto;
  lines: PayrollLineDto[];
  accounts: AccountDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("payroll.write");
  const canPay = useCan("payroll.pay");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const draft = run.status === "draft";
  const refresh = () => router.refresh();

  async function act(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      const withMessage = result as { message?: string } | undefined;
      setNotice(withMessage?.message ?? message ?? null);
      refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link
        href="/payroll"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All payroll runs
      </Link>

      <PageHeader
        title={`Salary sheet — ${run.label}`}
        description={`${lines.length} people · ${PAYROLL_STATUS_LABELS[run.status]}`}
        actions={
          <>
            {canWrite && draft ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => act(() => payrollApi.generateLines(run.id))}
              >
                <RefreshCw className="size-4" />
                {lines.length ? "Rebuild list" : "Build list"}
              </Button>
            ) : null}
            {canWrite && draft && lines.length > 0 ? (
              <Button
                variant="primary"
                size="md"
                disabled={busy}
                onClick={() =>
                  act(() => payrollApi.finalize(run.id), "Figures locked.")
                }
              >
                <Lock className="size-4" />
                Finalise
              </Button>
            ) : null}
            {canWrite && run.status === "finalized" ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => act(() => payrollApi.reopen(run.id))}
              >
                <Unlock className="size-4" />
                Reopen
              </Button>
            ) : null}
            {canPay && run.status === "finalized" ? (
              <Button variant="primary" size="md" onClick={() => setPaying(true)}>
                <CircleCheck className="size-4" />
                Mark paid
              </Button>
            ) : null}
          </>
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label="Gross" value={run.totalGross} />
        <Figure label="Additions" value={run.totalAdditions} />
        <Figure
          label="Tax withheld"
          value={run.totalTds}
          hint="Stays with you until the challan is deposited"
        />
        <Figure label="Net to pay" value={run.totalNet} emphasis />
      </div>

      {run.status === "draft" ? (
        <div className="flex items-start gap-3 rounded-lg bg-surface-muted px-4 py-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing has left the bank. Type each person&apos;s tax into the
            table, finalise to lock the figures, then mark it paid — that last
            step is what creates the ledger entry.
          </p>
        </div>
      ) : null}

      {lines.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            The list is empty. Build it to pull in everyone employed this month
            at the pay they were on.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-data min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <Th className="w-20">Code</Th>
                  <Th>Name</Th>
                  <Th className="w-28 text-right">Gross</Th>
                  <Th className="w-28 text-right">Bonus</Th>
                  <Th className="w-28 text-right">Other +</Th>
                  <Th className="w-28 text-right">Tax</Th>
                  <Th className="w-28 text-right">Other −</Th>
                  <Th className="w-32 text-right">Net</Th>
                  <Th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    editable={canWrite && draft}
                    onSaved={refresh}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-strong bg-surface-muted/50">
                  <td className="px-4 py-3 font-semibold" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-3">
                    <Amount value={run.totalGross} tone="neutral" className="block font-semibold" />
                  </td>
                  <td colSpan={2} />
                  <td className="px-4 py-3">
                    <Amount value={run.totalTds} tone="neutral" className="block font-semibold" />
                  </td>
                  <td />
                  <td className="px-4 py-3">
                    <Amount value={run.totalNet} tone="neutral" className="block font-semibold" />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <PayForm
        open={paying}
        run={run}
        accounts={accounts}
        onClose={() => setPaying(false)}
        onPaid={refresh}
      />
    </>
  );
}

function LineRow({
  line,
  editable,
  onSaved,
}: {
  line: PayrollLineDto;
  editable: boolean;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(field: string, value: string) {
    setSaving(true);
    setError(null);
    try {
      const result = await payrollApi.updateLine(line.id, { [field]: value });
      setWarning(result.warning ?? null);
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save that.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={cn("row-finance", line.isPaid && "bg-positive/5")}>
      <td className="num px-4 py-2 text-muted-foreground">{line.employeeCode}</td>
      <td className="px-4 py-2">
        <span className="font-medium">{line.fullName}</span>
        <span className="block text-xs text-muted-foreground">
          {line.snapshotDesignation ?? "—"}
        </span>
        {warning ? (
          <span className="mt-0.5 block text-xs text-warning">{warning}</span>
        ) : null}
        {error ? (
          <span className="mt-0.5 block text-xs text-negative">{error}</span>
        ) : null}
      </td>
      <Cell value={line.grossAmount} field="grossAmount" editable={editable} onSave={save} />
      <Cell value={line.bonusAmount} field="bonusAmount" editable={editable} onSave={save} />
      <Cell value={line.otherAdditions} field="otherAdditions" editable={editable} onSave={save} />
      <Cell value={line.tdsAmount} field="tdsAmount" editable={editable} onSave={save} highlight />
      <Cell value={line.otherDeductions} field="otherDeductions" editable={editable} onSave={save} />
      <td className="px-4 py-2">
        <Amount value={line.netAmount} tone="neutral" className="block font-semibold" />
      </td>
      <td className="px-4 py-2 text-right">
        {saving ? (
          <LoaderCircle className="ml-auto size-3.5 animate-spin text-muted-foreground" />
        ) : line.isPaid ? (
          <Link
            href={`/payroll/${line.id}/payslip`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Printer className="size-3" />
            Payslip
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/** Edits in place — a payroll sheet is a grid, not twenty separate forms. */
function Cell({
  value,
  field,
  editable,
  highlight = false,
  onSave,
}: {
  value: string;
  field: string;
  editable: boolean;
  highlight?: boolean;
  onSave: (field: string, value: string) => void;
}) {
  if (!editable) {
    return (
      <td className="px-4 py-2">
        <Amount value={value} tone="neutral" className="block" />
      </td>
    );
  }

  return (
    <td className="px-2 py-1.5">
      <input
        defaultValue={value}
        inputMode="decimal"
        onBlur={(event) => {
          if (event.target.value !== value) onSave(field, event.target.value);
        }}
        className={cn(
          "col-amount h-8 w-full rounded border border-transparent bg-transparent px-2 text-sm outline-none transition",
          "hover:border-border focus-visible:border-primary focus-visible:bg-surface",
          highlight && "font-medium",
        )}
      />
    </td>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Figure({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("p-5", emphasis && "border-primary/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <Amount
        value={value}
        tone="neutral"
        className="mt-3 block text-xl font-semibold tracking-tight"
      />
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}

function PayForm({
  open,
  run,
  accounts,
  onClose,
  onPaid,
}: {
  open: boolean;
  run: PayrollRunDto;
  accounts: AccountDto[];
  onClose: () => void;
  onPaid: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await payrollApi.pay(run.id, {
        paymentDate: String(data.get("paymentDate")),
        accountId: String(data.get("accountId")),
        paymentMode: String(data.get("paymentMode")) as never,
        paymentMethod: "bank_transfer",
      });
      onPaid();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not pay.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Pay ${run.label}`}
      description="This is the step that moves money and writes to the ledger."
    >
      <div className="mb-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Leaving the account
        </p>
        <Amount
          value={run.totalNet}
          tone="out"
          className="mt-2 block text-2xl font-semibold"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          The <Amount value={run.totalTds} tone="neutral" /> of tax withheld is
          not part of this —
          it stays with you until you deposit the challan.
        </p>
      </div>

      <form id="pay-run-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Payment date" required>
          <DateInput name="paymentDate" required defaultValue={todayInDhaka()} />
        </Field>
        <Field label="From which account" required>
          <Select name="accountId" required defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="How it appears in the ledger"
          hint="Match how your bank statement shows it, so the register lines up"
        >
          <Select name="paymentMode" defaultValue="consolidated">
            {PAYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYMENT_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
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
        <Button type="submit" form="pay-run-form" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record the payment
        </Button>
      </div>
    </Drawer>
  );
}
