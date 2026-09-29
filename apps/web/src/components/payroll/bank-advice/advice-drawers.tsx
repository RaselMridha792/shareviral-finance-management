"use client";

import { formatMoney, todayInDhaka } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import {
  PAYMENT_TYPES,
  PAYMENT_TYPE_LABELS,
  SCB_CODE,
  bankAdviceApi,
  type BankAdviceDto,
  type BankAdviceLineDto,
  type PaymentType,
} from "@/lib/bank-advice";
import type { AccountDto } from "@/lib/masters";
import type { PayrollRunDto } from "@/lib/payroll";

/** The account number as column I writes it: two zeros, then the digits. */
export function debitNoOf(accountNumber: string | null | undefined): string {
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("00") ? digits : `00${digits}`;
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
    >
      {error}
    </p>
  );
}

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("That did not go through. Try again.");
      }
    } finally {
      setPending(false);
    }
  }
  return { pending, error, fieldErrors, run };
}

function Footer({
  form,
  pending,
  label,
  onClose,
}: {
  form: string;
  pending: boolean;
  label: string;
  onClose: () => void;
}) {
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="submit"
        form={form}
        variant="primary"
        disabled={pending}
        data-advice-submit
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {label}
      </Button>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  From a salary sheet                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The advice the owner builds every month: a salary sheet in, one payment
 * per person out, their bank details from their team record. What is left
 * out — nothing to pay, or paid to a mobile wallet — is said before the new
 * advice opens, not discovered at the bank.
 */
export function FromPayrollDrawer({
  runs,
  accounts,
  onClose,
}: {
  runs: PayrollRunDto[];
  accounts: AccountDto[];
  onClose: () => void;
}) {
  const router = useRouter();
  const settings = useSettings();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [runId, setRunId] = useState(runs[0]?.id ?? "");
  const chosen = runs.find((one) => one.id === runId) ?? null;
  const [accountId, setAccountId] = useState(
    chosen?.accountId ?? accounts[0]?.id ?? "",
  );
  const [details, setDetails] = useState(
    chosen ? `Salary ${chosen.label}` : "",
  );
  /* The sheet's payment date when it is still ahead, else today: the bank
     takes today or a later date, never one gone by. */
  const today = todayInDhaka();
  const upcoming = (date: string | null | undefined) =>
    date && date >= today ? date : today;
  const [valueDate, setValueDate] = useState(upcoming(chosen?.paymentDate));
  const [paymentType, setPaymentType] = useState<PaymentType>("PAY");
  const [includeEmails, setIncludeEmails] = useState(false);
  const [result, setResult] = useState<{
    advice: BankAdviceDto;
    skipped: { name: string; reason: string }[];
  } | null>(null);

  function pickRun(id: string) {
    setRunId(id);
    const next = runs.find((one) => one.id === id);
    if (!next) return;
    setDetails(`Salary ${next.label}`);
    if (next.accountId) setAccountId(next.accountId);
    setValueDate(upcoming(next.paymentDate));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const built = await bankAdviceApi.fromPayroll({
        payrollRunId: runId,
        valueDate,
        paymentDetails: details,
        paymentType,
        accountId: accountId || undefined,
        includeEmails,
      });
      if (built.skipped.length === 0) {
        router.push(`/payroll/bank-advice/${built.advice.id}`);
        return;
      }
      setResult(built);
    });
  }

  if (result) {
    return (
      <Drawer
        open
        onClose={onClose}
        title="Bank advice built"
        description={`${result.advice.lineCount} payments, ${formatMoney(result.advice.totalAmount, { format: settings.numberFormat })}.`}
        footer={
          <Button
            variant="primary"
            onClick={() =>
              router.push(`/payroll/bank-advice/${result.advice.id}`)
            }
            data-advice-open
          >
            Open it
          </Button>
        }
      >
        <div className="flex flex-col gap-3" data-advice-skipped>
          <p className="text-[14px]">
            {result.skipped.length === 1
              ? "One person on the sheet is not in it:"
              : `${result.skipped.length} people on the sheet are not in it:`}
          </p>
          <ul className="flex flex-col gap-1.5">
            {result.skipped.map((one) => (
              <li
                key={one.name}
                className="flex justify-between gap-3 rounded-lg bg-(--sv-subtle) px-3 py-2 text-[13.5px]"
              >
                <span className="font-extrabold">{one.name}</span>
                <span className="text-(--sv-muted)">{one.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-(--sv-muted)">
            Anyone who should be paid through the bank can be added on the
            advice with Add payment.
          </p>
        </div>
      </Drawer>
    );
  }

  const account = accounts.find((one) => one.id === accountId) ?? null;
  return (
    <Drawer
      open
      onClose={onClose}
      title="New bank advice from payroll"
      description="One payment per person on the salary sheet, with their bank details from the team record."
      footer={
        <Footer
          form="advice-from-payroll"
          pending={pending}
          label="Build the advice"
          onClose={onClose}
        />
      }
    >
      <form
        id="advice-from-payroll"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {runs.length === 0 ? (
          <p className="rounded-lg bg-(--sv-subtle) px-3 py-2 text-[13.5px]">
            There is no salary sheet yet. Start a month on Payroll first.
          </p>
        ) : null}
        <Field label="Salary sheet" required error={fieldErrors.payrollRunId}>
          <Select
            value={runId}
            onChange={(event) => pickRun(event.target.value)}
            required
            data-advice-field="run"
          >
            {runs.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label} ·{" "}
                {formatMoney(one.totalNet, { format: settings.numberFormat })}{" "}
                net · {one.status.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Paid from"
          required
          error={fieldErrors.accountId}
          hint={
            account
              ? debitNoOf(account.accountNumber)
                ? `The file writes it as ${debitNoOf(account.accountNumber)}`
                : "This account has no number on file — add it on Accounts, or type it on the advice"
              : undefined
          }
        >
          <Select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            data-advice-field="account"
          >
            {accounts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.accountNumber ? ` · ${one.accountNumber}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Value date"
            required
            error={fieldErrors.valueDate}
            hint="The day the bank pays — today or later"
          >
            <DateInput
              value={valueDate}
              onChange={(event) => setValueDate(event.target.value)}
              required
              min={today}
              data-advice-field="valueDate"
            />
          </Field>
          <Field label="Payment type" required error={fieldErrors.paymentType}>
            <Select
              value={paymentType}
              onChange={(event) =>
                setPaymentType(event.target.value as PaymentType)
              }
              data-advice-field="paymentType"
            >
              {PAYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PAYMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Payment details"
          required
          error={fieldErrors.paymentDetails}
          hint="Printed on each person's bank statement"
        >
          <Input
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={140}
            required
            data-advice-field="details"
          />
        </Field>
        <label className="flex cursor-pointer items-start gap-3 rounded-[11px] bg-(--sv-subtle) px-4 py-3 text-[13.5px]">
          <input
            type="checkbox"
            checked={includeEmails}
            onChange={(event) => setIncludeEmails(event.target.checked)}
            className="mt-0.5 size-4 accent-(--sv-violet)"
            data-advice-field="emails"
          />
          <span>
            <span className="font-extrabold">
              Email each person the bank&apos;s confirmation
            </span>
            <span className="block text-(--sv-muted)">
              Fills their email from the team record; the bank writes to it when
              the salary is paid.
            </span>
          </span>
        </label>
        <ErrorLine error={error} />
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/*  The advice's own details                                                   */
/* -------------------------------------------------------------------------- */

/** A blank advice, or the details of one: its name, the account, the date. */
export function AdviceDetailsDrawer({
  advice,
  accounts,
  onClose,
  onSaved,
}: {
  advice: BankAdviceDto | null;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: (saved: BankAdviceDto) => void;
}) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [accountId, setAccountId] = useState(
    advice?.accountId ?? accounts[0]?.id ?? "",
  );
  const account = accounts.find((one) => one.id === accountId) ?? null;
  const [debit, setDebit] = useState(
    advice?.debitAccountNo ?? debitNoOf(account?.accountNumber),
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    await run(async () => {
      const input = {
        title: text("title"),
        accountId: accountId || null,
        debitAccountNo: debit,
        debitCityCode: text("debitCityCode") || "DHK",
        valueDate: text("valueDate"),
        note: text("note") || null,
      };
      const saved = advice
        ? await bankAdviceApi.update(advice.id, input)
        : await bankAdviceApi.create(input);
      onSaved(saved);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={advice ? "Edit the advice" : "New blank bank advice"}
      description={
        advice
          ? "Its name, the account it is paid from, and the value date."
          : "For payments that are not a salary sheet — rent, a supplier. Add the payments on the next page."
      }
      footer={
        <Footer
          form="advice-details"
          pending={pending}
          label={advice ? "Save" : "Create"}
          onClose={onClose}
        />
      }
    >
      <form
        id="advice-details"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={fieldErrors.title}>
          <Input
            name="title"
            required
            maxLength={160}
            defaultValue={advice?.title ?? ""}
            placeholder="Supplier payments — October"
            data-advice-field="title"
          />
        </Field>
        <Field label="Paid from" required error={fieldErrors.accountId}>
          <Select
            value={accountId}
            onChange={(event) => {
              setAccountId(event.target.value);
              const next = accounts.find(
                (one) => one.id === event.target.value,
              );
              setDebit(debitNoOf(next?.accountNumber));
            }}
            data-advice-field="account"
          >
            {accounts.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
                {one.accountNumber ? ` · ${one.accountNumber}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Field
            label="Debit A/C No."
            required
            error={fieldErrors.debitAccountNo}
            hint="As the file writes it: two zeros, then the account number"
          >
            <Input
              value={debit}
              onChange={(event) => setDebit(event.target.value)}
              inputMode="numeric"
              className="num"
              maxLength={24}
              data-advice-field="debit"
            />
          </Field>
          <Field
            label="City code"
            required
            error={fieldErrors.debitCityCode}
            hint="DHK for Dhaka"
          >
            <Input
              name="debitCityCode"
              defaultValue={advice?.debitCityCode ?? "DHK"}
              maxLength={3}
              className="uppercase"
            />
          </Field>
        </div>
        <Field
          label="Value date"
          required
          error={fieldErrors.valueDate}
          hint="Today or later — the bank takes no date gone by"
        >
          <DateInput
            name="valueDate"
            required
            defaultValue={advice?.valueDate ?? todayInDhaka()}
            min={todayInDhaka()}
            data-advice-field="valueDate"
          />
        </Field>
        <Field label="Note" error={fieldErrors.note}>
          <Textarea
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={advice?.note ?? ""}
          />
        </Field>
        <ErrorLine error={error} />
      </form>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/*  One payment                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One payment: who, where, how much, what for.
 *
 * The bank is asked as the choice it is — Standard Chartered, or another bank
 * and its routing number — rather than as a code to type: the file's
 * SCBLBDDXXXX and the two zeros in front of a routing number are the file's
 * business, and the page shows what it will write.
 */
export function LineDrawer({
  adviceId,
  line,
  onClose,
  onSaved,
}: {
  adviceId: string;
  /** Null to add one. */
  line: BankAdviceLineDto | null;
  onClose: () => void;
  onSaved: (advice: BankAdviceDto) => void;
}) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const startsScb = line ? line.bankCode === SCB_CODE : true;
  const [bank, setBank] = useState<"scb" | "other">(
    startsScb ? "scb" : "other",
  );
  const [routing, setRouting] = useState(
    line && !startsScb ? line.bankCode.replace(/^00(?=\d{9}$)/, "") : "",
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    line?.paymentType ?? "PAY",
  );

  const routingDigits = routing.replace(/\D/g, "");
  const code =
    bank === "scb"
      ? SCB_CODE
      : routingDigits.length === 9
        ? `00${routingDigits}`
        : routingDigits;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    await run(async () => {
      const input = {
        paymentType,
        beneficiaryName: text("beneficiaryName"),
        bankCode: code,
        accountNo: text("accountNo"),
        paymentDetails: text("paymentDetails"),
        amount: text("amount").replace(/[,\s৳]/g, ""),
        email: text("email") || null,
      };
      const saved = line
        ? await bankAdviceApi.updateLine(adviceId, line.id, input)
        : await bankAdviceApi.addLine(adviceId, input);
      onSaved(saved);
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={line ? `Payment to ${line.beneficiaryName}` : "Add a payment"}
      description="One row of the bank's file."
      footer={
        <Footer
          form="advice-line"
          pending={pending}
          label={line ? "Save" : "Add"}
          onClose={onClose}
        />
      }
    >
      <form
        id="advice-line"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {line && line.problems.length > 0 ? (
          <ul
            className="flex flex-col gap-1 rounded-[11px] bg-(--sv-warn-tint) px-3.5 py-2.5 text-[13px] text-(--sv-warn)"
            data-line-problems
          >
            {line.problems.map((problem) => (
              <li key={problem}>• {problem}</li>
            ))}
          </ul>
        ) : null}
        <Field
          label="Beneficiary name"
          required
          error={fieldErrors.beneficiaryName}
          hint="As the bank account holds it, in English letters"
        >
          <Input
            name="beneficiaryName"
            required
            maxLength={140}
            defaultValue={line?.beneficiaryName ?? ""}
            data-line-field="name"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank" required>
            <Select
              value={bank}
              onChange={(event) =>
                setBank(event.target.value as "scb" | "other")
              }
              data-line-field="bank"
            >
              <option value="scb">Standard Chartered (SCB)</option>
              <option value="other">Another bank</option>
            </Select>
          </Field>
          {bank === "other" ? (
            <Field
              label="Routing number"
              required
              error={fieldErrors.bankCode}
              hint={
                routingDigits.length === 9
                  ? `The file writes ${code}`
                  : "Nine digits"
              }
            >
              <Input
                value={routing}
                onChange={(event) => setRouting(event.target.value)}
                inputMode="numeric"
                className="num"
                maxLength={11}
                data-line-field="routing"
              />
            </Field>
          ) : (
            <Field label="Bank code" hint="What the file writes">
              <Input value={SCB_CODE} readOnly disabled className="num" />
            </Field>
          )}
        </div>
        <Field
          label="Account number"
          required
          error={fieldErrors.accountNo}
          hint="Digits only — spaces, dots and dashes are taken out"
        >
          <Input
            name="accountNo"
            required
            maxLength={34}
            inputMode="numeric"
            className="num"
            defaultValue={line?.accountNo ?? ""}
            data-line-field="account"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Amount (BDT)" required error={fieldErrors.amount}>
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              defaultValue={line?.amount ?? ""}
              data-line-field="amount"
            />
          </Field>
          <Field label="Payment type" required error={fieldErrors.paymentType}>
            <Select
              value={paymentType}
              onChange={(event) =>
                setPaymentType(event.target.value as PaymentType)
              }
              data-line-field="type"
            >
              {PAYMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PAYMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Payment details"
          required
          error={fieldErrors.paymentDetails}
          hint="Printed on their bank statement"
        >
          <Input
            name="paymentDetails"
            required
            maxLength={140}
            defaultValue={line?.paymentDetails ?? ""}
            data-line-field="details"
          />
        </Field>
        <Field
          label="Email"
          error={fieldErrors.email}
          hint="Optional — the bank sends them a confirmation"
        >
          <Input
            name="email"
            type="email"
            maxLength={254}
            defaultValue={line?.email ?? ""}
            data-line-field="email"
          />
        </Field>
        <ErrorLine error={error} />
      </form>
    </Drawer>
  );
}
