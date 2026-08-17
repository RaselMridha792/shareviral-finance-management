"use client";

import {
  FILING_STATUS_LABELS,
  TDS_DEPOSIT_TYPE_LABELS,
  isSelectableMonth,
  nearestSelectableMonth,
  recordYears,
  todayInDhaka,
  type TdsDepositType,
} from "@finance/shared";
import {
  AlertTriangle,
  Check,
  Download,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { exportUrl } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";
import { ApiError } from "@/lib/api-client";
import {
  tdsApi,
  type TdsDepositDto,
  type TdsLiabilityDto,
  type WithholdingReturnDto,
} from "@/lib/tax";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const th =
  "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const thRight = `${th} text-right`;

export function WithholdingScreen({
  year,
  fiscalYear,
  liability,
  deposits,
  returns,
  accounts,
}: {
  year: number;
  fiscalYear: number;
  liability: TdsLiabilityDto;
  deposits: { items: TdsDepositDto[]; total: string };
  returns: WithholdingReturnDto[];
  accounts: AccountDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("tds.write");
  // Each read unconditionally: downloading needs both the right to export and
  // the right to see the tax figures.
  const canRunExports = useCan("exports.run");
  const canReadTds = useCan("tds.read");
  const canExport = canRunExports && canReadTds;
  const [recording, setRecording] = useState<{ year: number; month: number } | null>(
    null,
  );
  const [filing, setFiling] = useState<WithholdingReturnDto | null>(null);

  const today = todayInDhaka();
  const outstanding = Number(liability.totals.outstanding);
  /**
   * More deposited than was ever withheld.
   *
   * Worth its own figure because "still held" is clamped at zero: without this
   * an over-deposit reads as a settled month, and the card underneath said
   * "everything deducted has been deposited" — true, and the wrong thing to be
   * told when a challan carries a digit too many or names the wrong month.
   */
  const overDeposited = Number(liability.totals.overDeposited ?? 0);
  const overDepositedMonths = liability.months.filter(
    (m) => Number(m.overDeposited ?? 0) > 0,
  );

  return (
    <>
      <PageHeader
        title="Withholding tax"
        description="Tax deducted from salaries and vendor bills, the challans that deposited it, and the quarterly returns."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setRecording({ year, month: currentMonth(today) })}
            >
              <Plus className="size-4" />
              Record a challan
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <YearPicker
          value={year}
          onChange={(next) => router.push(`/tax/withholding?year=${next}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Deducted" value={liability.totals.deducted} />
        <SummaryCard label="Deposited" value={liability.totals.deposited} />
        <SummaryCard
          label="Still held"
          value={liability.totals.outstanding}
          tone={
            outstanding > 0
              ? "warning"
              : overDeposited > 0
                ? "neutral"
                : "positive"
          }
          note={
            outstanding > 0
              ? "Money withheld from someone else that has not reached the treasury"
              : overDeposited > 0
                ? "Nothing is owed — but more has been deposited than was withheld"
                : "Everything deducted has been deposited"
          }
        />
      </div>

      {/*
        Shown only when it happens, because a figure that is nearly always zero
        earns no permanent place on the screen. When it is not zero it is money
        already with the treasury that nobody is looking for — a challan typed
        with an extra digit, or filed against the wrong month.
      */}
      {overDeposited > 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium">
              <Amount value={liability.totals.overDeposited} tone="neutral" />{" "}
              deposited beyond what was withheld
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {overDepositedMonths.length === 1
                ? `${overDepositedMonths[0].label} has a challan larger than that month's deductions.`
                : `${overDepositedMonths.map((m) => m.label).join(", ")} each have a challan larger than that month's deductions.`}{" "}
              Check the amount on the challan and the month it names — this is
              money already with the treasury.
            </p>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          title="Month by month"
          description="Salary tax comes from the payroll sheet; vendor tax from the withheld column on payments."
          action={
            canExport ? (
              <ExcelButton target="tds/liability" query={{ year }} />
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <table className="table-data min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Month</th>
                <th className={thRight}>Salary tax</th>
                <th className={thRight}>Vendor tax</th>
                <th className={thRight}>Deducted</th>
                <th className={thRight}>Deposited</th>
                <th className={thRight}>Still held</th>
                <th className={th}>Deposit by</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {liability.months.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No tax was deducted in {year}.
                  </td>
                </tr>
              ) : (
                liability.months.map((row) => {
                  const held = Number(row.outstanding);
                  const over = Number(row.overDeposited ?? 0);
                  const late = held > 0 && row.dueOn < today;
                  return (
                    <tr
                      key={row.month}
                      className="row-finance hover:bg-surface-muted/50"
                    >
                      <td className="px-4 py-2.5 font-medium">{row.label}</td>
                      <td className="px-4 py-2.5">
                        <Amount value={row.salaryTds} tone="neutral" className="block" />
                      </td>
                      <td className="px-4 py-2.5">
                        <Amount value={row.vendorTds} tone="neutral" className="block" />
                      </td>
                      <td className="px-4 py-2.5">
                        <Amount
                          value={row.totalDeducted}
                          tone="neutral"
                          className="block font-medium"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Amount
                          value={row.deposited}
                          tone="neutral"
                          className={
                            over > 0 ? "block font-medium text-warning" : "block"
                          }
                        />
                        {/* Marked on the deposit, not on "still held", because
                            the deposit is the figure that is wrong. */}
                        {over > 0 ? (
                          <span className="mt-0.5 block text-xs text-warning">
                            <Amount
                              value={row.overDeposited}
                              tone="neutral"
                              className="inline"
                            />{" "}
                            more than was withheld
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <Amount
                          value={row.outstanding}
                          tone="neutral"
                          className={
                            held > 0 ? "block font-medium text-warning" : "block"
                          }
                        />
                      </td>
                      <td className="num px-4 py-2.5 text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          {row.dueOn}
                          {late ? (
                            <AlertTriangle
                              className="size-3.5 text-negative"
                              aria-label="Past the deadline"
                            />
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canWrite && held > 0 ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setRecording({ year: row.year, month: row.month })
                            }
                          >
                            Deposit
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Challans"
          description="Each A-Challan and the month of deductions it covers."
          action={
            canExport ? (
              <ExcelButton target="tds/deposits" query={{ year }} />
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <table className="table-data min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Challan</th>
                <th className={th}>Deposited</th>
                <th className={th}>Covers</th>
                <th className={th}>Type</th>
                <th className={th}>Bank</th>
                <th className={thRight}>Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {deposits.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                  >
                    No challans recorded for {year} yet.
                  </td>
                </tr>
              ) : (
                deposits.items.map((row) => (
                  <tr key={row.id} className="row-finance hover:bg-surface-muted/50">
                    <td className="num px-4 py-2.5 font-medium">
                      {row.challanNumber}
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {row.depositDate}
                    </td>
                    <td className="px-4 py-2.5">{row.periodLabel}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {TDS_DEPOSIT_TYPE_LABELS[row.depositType]}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.bankName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount value={row.amount} tone="neutral" className="block" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={`Quarterly returns · FY ${fiscalYear}-${String(fiscalYear + 1).slice(-2)}`}
          description="Due on the 25th of the month after each quarter — 25 Oct, 25 Jan, 25 Apr, 25 Jul."
          action={
            canExport ? (
              <ExcelButton target="tds/returns" query={{ fiscalYear }} />
            ) : null
          }
        />
        <div className="overflow-x-auto">
          <table className="table-data min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Quarter</th>
                <th className={th}>Covers</th>
                <th className={th}>Due</th>
                <th className={th}>Status</th>
                <th className={th}>Filed on</th>
                <th className={th}>Acknowledgement</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {returns.map((row) => (
                <tr key={row.id} className="row-finance hover:bg-surface-muted/50">
                  <td className="px-4 py-2.5 font-medium">Q{row.quarter}</td>
                  <td className="num px-4 py-2.5 text-muted-foreground">
                    {row.periodStart} → {row.periodEnd}
                  </td>
                  <td className="num px-4 py-2.5">{row.dueDate}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      tone={
                        row.status === "filed"
                          ? "positive"
                          : row.status === "late"
                            ? "warning"
                            : row.isOverdue
                              ? "negative"
                              : "neutral"
                      }
                    >
                      {row.isOverdue && row.status === "pending"
                        ? "Overdue"
                        : FILING_STATUS_LABELS[row.status]}
                    </Badge>
                  </td>
                  <td className="num px-4 py-2.5 text-muted-foreground">
                    {row.filedOn ?? "—"}
                  </td>
                  <td className="num px-4 py-2.5 text-muted-foreground">
                    {row.acknowledgementNo ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canWrite && row.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setFiling(row)}
                      >
                        Mark filed
                      </Button>
                    ) : row.status !== "pending" ? (
                      <Check className="ml-auto size-4 text-positive" />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ChallanForm
        // Keyed on the month, so opening "record a challan" for July after
        // looking at June starts on July rather than on whatever the form was
        // last left showing.
        key={recording ? `${recording.year}-${recording.month}` : "none"}
        target={recording}
        accounts={accounts}
        onClose={() => setRecording(null)}
        onSaved={() => {
          setRecording(null);
          router.refresh();
        }}
      />
      <FileReturnForm
        record={filing}
        onClose={() => setFiling(null)}
        onSaved={() => {
          setFiling(null);
          router.refresh();
        }}
      />
    </>
  );
}

/**
 * One button per table, not one for the screen.
 *
 * This page shows three different things — the monthly position, the challans,
 * and the quarterly returns — and each is its own sheet with its own filter.
 */
function ExcelButton({
  target,
  query,
}: {
  target: string;
  query: Record<string, string | number | undefined>;
}) {
  return (
    <Button
      variant="secondary"
      size="md"
      onClick={() => {
        window.location.href = exportUrl(target, query);
      }}
    >
      <Download className="size-4" />
      Excel
    </Button>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "positive";
  note?: string;
}) {
  return (
    <Card className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <Amount
        value={value}
        tone="neutral"
        className={`text-xl font-medium ${
          tone === "warning"
            ? "text-warning"
            : tone === "positive"
              ? "text-positive"
              : ""
        }`}
      />
      {note ? (
        <span className="text-xs text-muted-foreground">{note}</span>
      ) : null}
    </Card>
  );
}

function YearPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (year: number) => void;
}) {
  // 2026 onwards, growing on its own. It used to offer next year and two years
  // back — three years the company has no withholding records for, and one of
  // them not yet begun.
  const years = recordYears();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Year</span>
      <Select
        className="h-9 w-28"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ChallanForm({
  target,
  accounts,
  onClose,
  onSaved,
}: {
  target: { year: number; month: number } | null;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayInDhaka();

  // Which month's deductions the challan covers. Held here rather than read off
  // the form on submit, because the month list has to grey out what the chosen
  // year cannot have, and two uncontrolled boxes cannot see each other.
  const [coversYear, setCoversYear] = useState(
    target?.year ?? Number(today.slice(0, 4)),
  );
  const [coversMonth, setCoversMonth] = useState(
    target?.month ?? Number(today.slice(5, 7)),
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const accountId = String(data.get("accountId") ?? "");

    try {
      await tdsApi.createDeposit({
        challanNumber: String(data.get("challanNumber") ?? "").trim(),
        challanDate: String(data.get("challanDate") ?? ""),
        depositDate: String(data.get("depositDate") ?? ""),
        amount: String(data.get("amount") ?? "").replace(/,/g, ""),
        bankName: String(data.get("bankName") ?? "") || undefined,
        branch: String(data.get("branch") ?? "") || undefined,
        periodYear: coversYear,
        periodMonth: coversMonth,
        depositType: String(data.get("depositType")) as TdsDepositType,
        accountId: accountId || undefined,
        notes: String(data.get("notes") ?? "") || undefined,
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not record that challan.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={target !== null}
      onClose={onClose}
      title="Record a TDS challan"
    >
      {target ? (
        <form id="challan-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Challan number" required>
              <Input name="challanNumber" autoFocus className="num" />
            </Field>
            <Field label="Challan date" required>
              <DateInput name="challanDate" defaultValue={today} />
            </Field>
            <Field
              label="Deposited on"
              required
              hint="The date the bank took the money"
            >
              <DateInput name="depositDate" defaultValue={today} />
            </Field>
            <Field label="Amount" required>
              <MoneyInput name="amount" placeholder="0.00" />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/*
              Which month's deductions this challan covers. Controlled, so the
              month list can grey out what the chosen year cannot have — a
              challan filed against a month that has not happened would allocate
              against deductions nobody has made.
            */}
            <Field label="Deductions from" required>
              <Select
                value={coversMonth}
                onChange={(event) => setCoversMonth(Number(event.target.value))}
              >
                {MONTHS.map((name, index) => (
                  <option
                    key={name}
                    value={index + 1}
                    disabled={!isSelectableMonth(coversYear, index + 1)}
                  >
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Year" required>
              <Select
                value={coversYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setCoversYear(next);
                  setCoversMonth((current) =>
                    nearestSelectableMonth(next, current),
                  );
                }}
              >
                {recordYears().map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Covers">
            <Select name="depositType" defaultValue="salary">
              {Object.entries(TDS_DEPOSIT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Paid from"
            hint="Leave blank if this payment is already in the ledger. Choosing an account writes the money-out row for you."
          >
            <Select name="accountId" defaultValue="">
              <option value="">Do not write a ledger entry</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bank">
              <Input name="bankName" />
            </Field>
            <Field label="Branch">
              <Input name="branch" />
            </Field>
          </div>

          <Field label="Notes">
            <Textarea name="notes" />
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
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="challan-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record
        </Button>
      </div>
    </Drawer>
  );
}

function FileReturnForm({
  record,
  onClose,
  onSaved,
}: {
  record: WithholdingReturnDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!record) return;
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await tdsApi.fileReturn(record.id, {
        filedOn: String(data.get("filedOn") ?? ""),
        acknowledgementNo: String(data.get("acknowledgementNo") ?? "") || undefined,
        notes: String(data.get("notes") ?? "") || undefined,
      });
      onSaved();
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
      open={record !== null}
      onClose={onClose}
      title={record ? `Q${record.quarter} withholding return` : ""}
    >
      {record ? (
        <form id="file-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Covers {record.periodStart} to {record.periodEnd}, due{" "}
            <span className="num">{record.dueDate}</span>.
          </p>
          <Field label="Filed on" required>
            <DateInput name="filedOn" defaultValue={todayInDhaka()} />
          </Field>
          <Field label="Acknowledgement number">
            <Input name="acknowledgementNo" className="num" />
          </Field>
          <Field label="Notes">
            <Textarea name="notes" />
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
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="file-form" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}

function currentMonth(today: string): number {
  return Number(today.slice(5, 7));
}
