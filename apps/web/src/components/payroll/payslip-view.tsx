"use client";

import { PAYMENT_METHOD_LABELS, formatMoney } from "@finance/shared";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";

import type { AppSettingsDto } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import type { PayslipDto } from "@/lib/payroll";

/**
 * One person's payslip, laid out to print on a single page.
 *
 * `window.print()` rather than a PDF library: it needs no extra dependency in
 * the container, works offline, and produces a real PDF through the browser's
 * own "save as PDF".
 */
export function PayslipView({
  payslip,
  settings,
}: {
  payslip: PayslipDto;
  settings: AppSettingsDto;
}) {
  const money = (value: string) =>
    formatMoney(value, {
      currency: settings.baseCurrency,
      format: settings.numberFormat,
    });

  const additions = [
    ["Gross salary", payslip.grossAmount],
    ["Bonus", payslip.bonusAmount],
    ["Other additions", payslip.otherAdditions],
  ].filter(([, value]) => Number(value) !== 0);

  const deductions = [
    ["Tax deducted at source", payslip.tdsAmount],
    [payslip.deductionNote ?? "Other deductions", payslip.otherDeductions],
  ].filter(([, value]) => Number(value) !== 0);

  return (
    <>
      {/* Hidden when printing — the sheet itself is the document. */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href={`/payroll/${payslip.runId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to the salary sheet
        </Link>
        <Button variant="primary" size="md" onClick={() => window.print()}>
          <Printer className="size-4" />
          Print or save as PDF
        </Button>
      </div>

      <article className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-surface p-8 shadow-e1 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {settings.companyName}
            </h1>
            {settings.companyAddress ? (
              <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
                {settings.companyAddress}
              </p>
            ) : null}
            {settings.companyEtin ? (
              <p className="num mt-0.5 text-xs text-muted-foreground">
                e-TIN {settings.companyEtin}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Payslip
            </p>
            <p className="mt-1 text-sm font-semibold">{payslip.runLabel}</p>
          </div>
        </header>

        <section className="grid gap-x-8 gap-y-2 border-b border-border py-5 text-sm sm:grid-cols-2">
          <Line label="Name" value={payslip.fullName} />
          <Line label="Employee code" value={payslip.employeeCode} mono />
          <Line label="Designation" value={payslip.snapshotDesignation ?? "—"} />
          <Line label="Department" value={payslip.snapshotDepartment ?? "—"} />
          <Line label="e-TIN" value={payslip.snapshotEtin ?? "—"} mono />
          <Line
            label="Bank account"
            value={
              [payslip.snapshotBankName, payslip.snapshotBankAccount]
                .filter(Boolean)
                .join(" · ") || "—"
            }
            mono
          />
        </section>

        <section className="grid gap-8 py-5 sm:grid-cols-2">
          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Earnings
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {additions.map(([label, value]) => (
                  <tr key={label}>
                    <td className="py-1">{label}</td>
                    <td className="col-amount py-1">{money(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Deductions
            </h2>
            {deductions.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">None</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {deductions.map(([label, value]) => (
                    <tr key={label}>
                      <td className="py-1">{label}</td>
                      <td className="col-amount py-1">{money(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="flex flex-wrap items-baseline justify-between gap-3 border-y-2 border-ink py-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              Net pay
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {inWords(Number(payslip.netAmount))}
            </p>
          </div>
          <p className="col-amount text-2xl font-semibold">
            {money(payslip.netAmount)}
          </p>
        </section>

        <section className="grid gap-x-8 gap-y-2 py-5 text-sm sm:grid-cols-2">
          <Line
            label="Paid on"
            value={payslip.paidOn ?? "Not yet paid"}
            mono={Boolean(payslip.paidOn)}
          />
          <Line
            label="Method"
            value={
              PAYMENT_METHOD_LABELS[
                payslip.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS
              ] ?? payslip.paymentMethod
            }
          />
        </section>

        <footer className="mt-10 flex justify-between gap-8 text-xs text-muted-foreground">
          <div className="flex-1 border-t border-border-strong pt-2">
            Employee signature
          </div>
          <div className="flex-1 border-t border-border-strong pt-2 text-right">
            For {settings.companyName}
          </div>
        </footer>

        <p className="mt-6 text-center text-[10px] text-muted-foreground">
          Computer generated. Tax figures are as recorded by the company&apos;s
          accountant.
        </p>
      </article>
    </>
  );
}

function Line({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "num text-right" : "text-right"}>{value}</span>
    </div>
  );
}

/**
 * "Taka forty-five thousand only" — a payslip states the amount in words so a
 * printed figure cannot be quietly altered.
 */
function inWords(value: number): string {
  const whole = Math.floor(value);
  const paisa = Math.round((value - whole) * 100);

  const words = numberToWords(whole);
  const suffix = paisa > 0 ? ` and ${numberToWords(paisa)} paisa` : "";
  return `Taka ${words}${suffix} only`;
}

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty",
  "ninety",
];

/** Uses the South Asian scale — lakh and crore, matching how the figures read. */
function numberToWords(value: number): string {
  if (value === 0) return "zero";

  const parts: string[] = [];
  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;

  if (crore) parts.push(`${underThousand(crore)} crore`);
  if (lakh) parts.push(`${underThousand(lakh)} lakh`);
  if (thousand) parts.push(`${underThousand(thousand)} thousand`);
  if (rest) parts.push(underThousand(rest));

  return parts.join(" ");
}

function underThousand(value: number): string {
  if (value === 0) return "";
  if (value < 20) return ONES[value];
  if (value < 100) {
    const ten = Math.floor(value / 10);
    const one = value % 10;
    return one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten];
  }
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  return remainder
    ? `${ONES[hundred]} hundred ${underThousand(remainder)}`
    : `${ONES[hundred]} hundred`;
}
