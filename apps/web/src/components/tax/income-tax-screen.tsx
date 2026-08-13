"use client";

import {
  INCOME_TAX_STATUS_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { CalendarPlus, LoaderCircle, Pencil } from "lucide-react";
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
import { ApiError } from "@/lib/api-client";
import type { AccountDto } from "@/lib/masters";
import { incomeTaxApi, type IncomeTaxListDto, type IncomeTaxRecordDto } from "@/lib/tax";

const th =
  "px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const thRight = `${th} text-right`;

export function IncomeTaxScreen({
  data,
  fiscalYear,
  accounts,
}: {
  data: IncomeTaxListDto;
  fiscalYear: number;
  accounts: AccountDto[];
}) {
  const router = useRouter();
  const canWrite = useCan("incometax.write");
  const [editing, setEditing] = useState<IncomeTaxRecordDto | null>(null);
  const [paying, setPaying] = useState<IncomeTaxRecordDto | null>(null);
  const [generating, setGenerating] = useState(false);
  const today = todayInDhaka();

  async function generate() {
    setGenerating(true);
    try {
      await incomeTaxApi.schedule(fiscalYear);
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Company income tax"
        description="Tax on the company's own profit — four advance instalments and the annual return."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={generate}
              disabled={generating}
            >
              {generating ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CalendarPlus className="size-4" />
              )}
              Open FY {fiscalYear}-{String(fiscalYear + 1).slice(-2)}
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Assessed" value={data.totals.payable} />
        <SummaryCard label="Paid" value={data.totals.paid} />
        <SummaryCard
          label="Still to pay"
          value={data.totals.outstanding}
          highlight={Number(data.totals.outstanding) > 0}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Schedule"
          description="Advance instalments fall on 15 Sep, 15 Dec, 15 Mar and 15 Jun. NBR usually extends Tax Day by order, so every due date here can be edited."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted/50 text-left">
                <th className={th}>Assessment year</th>
                <th className={th}>What</th>
                <th className={th}>Due</th>
                <th className={thRight}>Assessed</th>
                <th className={thRight}>Paid</th>
                <th className={thRight}>Outstanding</th>
                <th className={th}>Challan</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No tax year has been opened yet.
                    {canWrite ? (
                      <>
                        {" "}
                        Use <strong>Open FY</strong> above to create the four
                        instalments and the annual return.
                      </>
                    ) : null}
                  </td>
                </tr>
              ) : (
                data.items.map((row) => (
                  <tr key={row.id} className="row-finance hover:bg-surface-muted/50">
                    <td className="num px-4 py-2.5">{row.assessmentYear}</td>
                    <td className="px-4 py-2.5 font-medium">{row.label}</td>
                    <td className="num px-4 py-2.5">
                      <span
                        className={
                          row.isOverdue ? "text-negative" : "text-muted-foreground"
                        }
                      >
                        {row.dueDate}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount value={row.amountPayable} tone="neutral" className="block" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount value={row.amountPaid} tone="neutral" className="block" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={row.outstanding}
                        tone="neutral"
                        className={
                          Number(row.outstanding) > 0
                            ? "block font-medium"
                            : "block text-muted-foreground"
                        }
                      />
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {row.challanNumber ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          row.status === "paid" || row.status === "filed"
                            ? "positive"
                            : row.status === "partially_paid"
                              ? "warning"
                              : row.isOverdue
                                ? "negative"
                                : "neutral"
                        }
                      >
                        {row.isOverdue && row.status === "pending"
                          ? "Overdue"
                          : INCOME_TAX_STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {canWrite ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(row)}
                            aria-label="Edit"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {row.status !== "paid" && row.status !== "filed" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setPaying(row)}
                            >
                              Pay
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Today in Dhaka is <span className="num">{today}</span>. Amounts come from
        the accountant&apos;s assessment — this screen records them, it does not
        compute them.
      </p>

      <EditForm
        record={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
      <PayForm
        record={paying}
        accounts={accounts}
        onClose={() => setPaying(null)}
        onSaved={() => {
          setPaying(null);
          router.refresh();
        }}
      />
    </>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-1 px-4 py-3.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <Amount
        value={value}
        tone="neutral"
        className={`text-xl font-medium ${highlight ? "text-warning" : ""}`}
      />
    </Card>
  );
}

function EditForm({
  record,
  onClose,
  onSaved,
}: {
  record: IncomeTaxRecordDto | null;
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
    const submitted = String(data.get("returnSubmittedOn") ?? "");

    try {
      await incomeTaxApi.update(record.id, {
        amountPayable: String(data.get("amountPayable") ?? "").replace(/,/g, ""),
        dueDate: String(data.get("dueDate") ?? ""),
        returnSubmittedOn: submitted || undefined,
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
      title={record ? `${record.label} · ${record.assessmentYear}` : ""}
    >
      {record ? (
        <form id="tax-edit" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="Assessed amount"
            required
            hint="What the accountant says is payable"
          >
            <MoneyInput name="amountPayable" defaultValue={record.amountPayable} />
          </Field>
          <Field
            label="Due date"
            required
            hint="Editable — NBR extends Tax Day most years"
          >
            <DateInput name="dueDate" defaultValue={record.dueDate} />
          </Field>

          {record.recordType === "final_return" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Return submitted on">
                <DateInput
                  name="returnSubmittedOn"
                  defaultValue={record.returnSubmittedOn ?? ""}
                />
              </Field>
              <Field label="Acknowledgement">
                <Input
                  name="acknowledgementNo"
                  className="num"
                  defaultValue={record.acknowledgementNo ?? ""}
                />
              </Field>
            </div>
          ) : null}

          <Field label="Notes">
            <Textarea name="notes" defaultValue={record.notes ?? ""} />
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
        <Button type="submit" form="tax-edit" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </Drawer>
  );
}

function PayForm({
  record,
  accounts,
  onClose,
  onSaved,
}: {
  record: IncomeTaxRecordDto | null;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayInDhaka();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (!record) return;
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await incomeTaxApi.pay(record.id, {
        amount: String(data.get("amount") ?? "").replace(/,/g, ""),
        paidOn: String(data.get("paidOn") ?? ""),
        challanNumber: String(data.get("challanNumber") ?? "").trim(),
        challanDate: String(data.get("challanDate") ?? ""),
        accountId: String(data.get("accountId") ?? ""),
      });
      onSaved();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not record that payment.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={record !== null}
      onClose={onClose}
      title={record ? `Pay ${record.label}` : ""}
    >
      {record ? (
        <form id="tax-pay" onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This writes a money-out row to the ledger, so the register still
            matches the bank statement.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" required>
              <MoneyInput
                name="amount"
                autoFocus
                defaultValue={
                  Number(record.outstanding) > 0 ? record.outstanding : ""
                }
              />
            </Field>
            <Field label="Paid on" required>
              <DateInput name="paidOn" defaultValue={today} />
            </Field>
            <Field label="Challan number" required>
              <Input name="challanNumber" className="num" />
            </Field>
            <Field label="Challan date" required>
              <DateInput name="challanDate" defaultValue={today} />
            </Field>
          </div>

          <Field label="Paid from" required>
            <Select name="accountId" defaultValue={accounts[0]?.id ?? ""}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
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
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="tax-pay" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record payment
        </Button>
      </div>
    </Drawer>
  );
}
