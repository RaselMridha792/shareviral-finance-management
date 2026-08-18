"use client";

import {
  calculateTds,
  PAYMENT_MODES,
  PAYMENT_MODE_LABELS,
  PAYROLL_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import {
  ArrowLeft,
  Calculator,
  CircleCheck,
  Download,
  LoaderCircle,
  Lock,
  ListTree,
  Printer,
  RefreshCw,
  Save,
  TriangleAlert,
  Unlock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { BreakdownDrawer } from "@/components/payroll/breakdown-drawer";
import { TdsWorking } from "@/components/tds/tds-working";
import { Amount } from "@/components/money/amount";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { exportUrl } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import {
  payrollApi,
  teamApi,
  type PayrollLineDto,
  type PayrollRunDto,
} from "@/lib/payroll";
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
  // Writing a compensation record is a pay decision, not a payroll one.
  const canSetPay = useCan("team.compensation.write");
  // `exports.run` alone is not enough for a file of salary figures — HR holds
  // it and does not hold payroll.read.
  const canRunExports = useCan("exports.run");
  const canReadPayroll = useCan("payroll.read");
  const canExport = canRunExports && canReadPayroll;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [reopening, setReopening] = useState(false);
  const toast = useToast();

  const draft = run.status === "draft";
  const refresh = () => router.refresh();

  /**
   * Commits whatever is still being typed, and says so.
   *
   * Blurring the focused cell fires the same per-field save the sheet already
   * does, so this adds no second way for a figure to reach the server — one
   * path, one audit row, no chance of the two disagreeing. What it adds is the
   * acknowledgement, which is the part that was missing.
   */
  function saveDraft() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    toast.show("Draft saved. Nothing is locked until you finalise.");
  }

  /**
   * Who the last build left out, because they have no pay on record.
   *
   * Kept so the screen can offer the way forward instead of only naming the
   * problem. The message alone read as a failure with no remedy — and the
   * remedy was eighteen profiles, opened one at a time.
   */
  const [skipped, setSkipped] = useState<string[]>([]);

  async function act(fn: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      const withMessage = result as
        | { message?: string; skipped?: string[] }
        | undefined;
      setNotice(withMessage?.message ?? message ?? null);
      setSkipped(withMessage?.skipped ?? []);
      refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Set the missing pay records from what each person was hired at.
   *
   * Offered here because here is where the gap is discovered. It writes real
   * compensation records dated from each person's own joining date, so an
   * earlier month computes correctly too — and it never touches anybody who
   * already has a figure.
   */
  async function setPayFromJoining() {
    setBusy(true);
    setError(null);
    try {
      const result = await teamApi.setPayFromJoiningSalary();
      if (!result.created) {
        setNotice(
          result.skipped.length
            ? `No joining salary is recorded for ${result.skipped.join(", ")}, so there is nothing to copy. Set their pay on the Team page.`
            : "Everybody already has pay on record.",
        );
        setSkipped([]);
      } else {
        setNotice(
          `Pay set for ${result.created} ${result.created === 1 ? "person" : "people"} from their joining salary. Build the list again.` +
            (result.skipped.length
              ? ` Still without a figure: ${result.skipped.join(", ")}.`
              : ""),
        );
        setSkipped(result.skipped);
      }
      refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not set pay.",
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
            {canExport ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  window.location.href = exportUrl(`payroll/${run.id}`, {});
                }}
              >
                <Download className="size-4" />
                Excel
              </Button>
            ) : null}
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
            {/*
              Separate from Rebuild, because rebuilding starts the sheet again
              and loses the bonuses and breakdowns typed since. The reason to
              want this is usually that the rates were published after the
              sheet was built.
            */}
            {canWrite && draft && lines.length ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => act(() => payrollApi.recalculateTds(run.id))}
              >
                <Calculator className="size-4" />
                Work out the tax again
              </Button>
            ) : null}
            {/*
              Save draft.

              The cells already save one at a time as you leave them, and that
              stays — eighteen people's tax figures typed against one Save
              button is eighteen people's work to lose. But a sheet that saves
              invisibly gives somebody no way to know it did, and the honest
              answer to "have my figures gone in" was previously to reload the
              page and look.

              So the button does the two things that are actually true: it
              commits whatever cell is still being typed in (blurring fires the
              same save the cell already does), and it says so. It is
              deliberately not the thing that persists the sheet — claiming
              that would be a lie about where the work is done.
            */}
            {canWrite && draft && lines.length > 0 ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={saveDraft}
              >
                <Save className="size-4" />
                Save draft
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
            {/*
              Reopen, on a paid run as well as a finalised one.

              It used to appear only on `finalized`, which left a paid run with
              no way back and nothing on screen saying why. The server has
              always allowed both — it asks the ledger rather than the status,
              so a run whose entries have all been voided reopens, and one with
              money still out is refused with a message naming how many entries
              are live and where to void them.

              Showing the button on a paid run is therefore not a shortcut past
              the rule; it is what makes the rule visible. Pressing it either
              works, because nothing is out, or explains itself.
            */}
            {canWrite &&
            (run.status === "finalized" || run.status === "paid") ? (
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() =>
                  run.status === "paid"
                    ? setReopening(true)
                    : act(() => payrollApi.reopen(run.id), "Open for editing.")
                }
              >
                <Unlock className="size-4" />
                {run.status === "paid" ? "Edit" : "Reopen"}
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
        <div className="flex flex-col gap-3 rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-muted-foreground">
          <p>{notice}</p>

          {/*
            The way out, next to the problem.

            The sheet reads compensation_history — what somebody earns now.
            An imported team member carries only the salary agreed at hire,
            which is a different fact and deliberately not used for pay on its
            own: it can be years old, and a run that quietly pays a 2024 figure
            is a wrong payment nobody notices. So it is offered as something a
            person does, once, and every record it writes names the amount in
            the audit log.
          */}
          {skipped.length && draft && canSetPay ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={setPayFromJoining}
              >
                Set their pay from the joining salary
              </Button>
              <span className="text-xs">
                Dated from each person&apos;s own joining date. Anyone who
                already has a figure is left alone.
              </span>
            </div>
          ) : null}
        </div>
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

      {/*
        Editing a run the money has already left on.

        Not a warning bolted onto a button that would have worked anyway — the
        server decides, and it decides by counting live ledger entries rather
        than by reading the status. This says what the two outcomes are before
        somebody presses it, so the refusal is not a surprise.
      */}
      <ConfirmDialog
        open={reopening}
        title="Edit a run that has already been paid?"
        confirmLabel="Try to reopen"
        body={
          <>
            This run was marked paid, so there are ledger entries against it and
            money has left the bank. Reopening it is only possible once those
            entries have been voided on the transaction list — the figures on a
            salary sheet and the payment made from it are not allowed to
            disagree.
            <span className="mt-2 block">
              If anything is still live, nothing will change and you will be
              told how many entries there are.
            </span>
          </>
        }
        onConfirm={() => {
          setReopening(false);
          void act(() => payrollApi.reopen(run.id), "Open for editing.");
        }}
        onCancel={() => setReopening(false)}
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
  const settings = useSettings();
  const [breakdown, setBreakdown] = useState(false);
  const [working, setWorking] = useState(false);
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
      <TdsCell line={line} onOpen={() => setWorking(true)} />
      <Cell value={line.otherDeductions} field="otherDeductions" editable={editable} onSave={save} />
      <td className="px-4 py-2">
        <Amount value={line.netAmount} tone="neutral" className="block font-semibold" />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-3">
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {editable ? (
            <button
              type="button"
              onClick={() => setBreakdown(true)}
              className="cursor-pointer text-xs text-muted-foreground transition hover:text-foreground"
            >
              <ListTree className="mr-1 inline size-3" />
              Breakdown
            </button>
          ) : null}
          {line.isPaid ? (
            <Link
              href={`/payroll/${line.id}/payslip`}
              prefetch={false}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Printer className="size-3" />
              Payslip
            </Link>
          ) : null}
        </div>

        {working ? (
          <TdsWorkingDrawer
            line={line}
            open={working}
            onClose={() => setWorking(false)}
          />
        ) : null}

        {breakdown ? (
          <BreakdownDrawer
            line={line}
            currency={settings.baseCurrency}
            numberFormat={settings.numberFormat}
            open={breakdown}
            onClose={() => setBreakdown(false)}
            onSaved={onSaved}
          />
        ) : null}
      </td>
    </tr>
  );
}

/**
 * The tax, which is no longer typed.
 *
 * A button rather than a figure, because a number somebody cannot check is a
 * number they will not trust — and the whole reason for working it out in the
 * app was so the arithmetic is there to be looked at. The amber mark is for a
 * line with no working behind it: a run from before the app calculated, or an
 * income year with no rule set up.
 */
function TdsCell({
  line,
  onOpen,
}: {
  line: PayrollLineDto;
  onOpen: () => void;
}) {
  return (
    <td className="px-4 py-2">
      <button
        type="button"
        onClick={onOpen}
        title={
          line.tdsBasis
            ? "How this was worked out"
            : "No rule was applied to this line"
        }
        className="flex w-full cursor-pointer items-center justify-end gap-1.5 rounded-md px-1 py-0.5 transition hover:bg-surface-muted"
      >
        {line.tdsBasis ? null : (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        )}
        <Amount value={line.tdsAmount} tone="neutral" />
      </button>
    </td>
  );
}

/**
 * The whole sum behind one person's deduction.
 *
 * Recomputed here from the frozen basis rather than fetched, so what is shown
 * is the arithmetic that produced the stored figure and not a fresh call
 * against whatever the rule says today. If the two ever disagree, that is
 * exactly what somebody needs to see, so the panel says so.
 */
function TdsWorkingDrawer({
  line,
  open,
  onClose,
}: {
  line: PayrollLineDto;
  open: boolean;
  onClose: () => void;
}) {
  const basis = line.tdsBasis;
  const result = basis
    ? calculateTds(basis.annualSalary, basis.policy, basis.declaredInvestment)
    : null;
  const agrees = result ? result.monthlyTds === line.tdsAmount : true;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${line.fullName} — how the tax was worked out`}
      description={
        basis
          ? `Under the ${basis.fiscalYear}-${String(basis.fiscalYear + 1).slice(2)} rule, on twelve times this month's gross`
          : undefined
      }
    >
      {!basis ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm">
          Nothing was worked out for this line — either it predates the app
          calculating tax, or no rule is set up for that income year. Settings →
          Salary TDS has the form, and then{" "}
          <strong>Work out the tax again</strong> applies it.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {!basis.exactYear ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2.5 text-sm">
              That income year had no rule of its own, so an earlier
              year&apos;s was used.
            </p>
          ) : null}

          {!agrees ? (
            <p className="rounded-lg bg-negative/10 px-3 py-2.5 text-sm">
              The stored figure and this working disagree. What is on the sheet
              is what will be deducted; <strong>Work out the tax again</strong>{" "}
              brings them back together.
            </p>
          ) : null}

          {result ? <TdsWorking result={result} /> : null}

          <p className="text-xs text-muted-foreground">
            The yearly figure is a projection — twelve times this month&apos;s
            gross. A raise changes it from that month on, and the months before
            it are not restated.
          </p>
        </div>
      )}
    </Drawer>
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
