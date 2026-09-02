"use client";

import {
  ENGAGEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  formatMoney,
  fromMinorUnits,
  monthRange,
  toMinorUnits,
} from "@finance/shared";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";

import type { AppSettingsDto } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { fileHref } from "@/lib/api-client";
import type { PayslipDto, PayslipLineDto } from "@/lib/payroll";

/**
 * One person's payslip, drawn to the company's own design.
 *
 * The measurements here are not invented. They are lifted from the PDF the
 * company already issues — a 138pt black band, a 3.5pt lime rule under it, a
 * card inset 46pt from each edge with a 3.5pt lime left border, two columns
 * 238.6pt wide separated by 26pt, a 74pt net block, a 58pt footer. Everything
 * is expressed in `pt` for that reason: CSS points and PDF points are the same
 * unit, so what is on screen is what came off the printer.
 *
 * It carries its own palette rather than the app's tokens, and deliberately.
 * A payslip is a document with the company's branding on it, not a screen —
 * it must look the same to somebody reading it in dark mode, printing it, and
 * opening the saved PDF a year later. Tokens that follow the viewer's theme
 * would give all three different documents.
 *
 * `window.print()` rather than a PDF library: no extra dependency in the
 * container, works offline, and the browser's own "Save as PDF" produces the
 * real file.
 */
export function PayslipView({
  payslip,
  settings,
  signature,
  preparedSignature,
}: {
  payslip: PayslipDto;
  settings: AppSettingsDto;
  /**
   * The file id of the company's signature, or null.
   *
   * Fetched by the page rather than looked up here, so the image is in the
   * markup the first time it renders — a signature that appears a moment after
   * the rest is a signature somebody prints without.
   */
  signature: string | null;
  /**
   * The mark of whoever prepared the slip, for the left block.
   *
   * Its own file kind rather than a second row of the same one: the two blocks
   * are different people signing different things, and `signature` is singular
   * by rule precisely so a slip never has to choose between two of them.
   */
  preparedSignature: string | null;
}) {
  const money = (value: string) =>
    formatMoney(value, {
      currency: settings.baseCurrency,
      // Always grouped the company's way on a document that leaves the
      // building — the payslip is not somebody's screen preference.
      format: settings.numberFormat,
      hideSymbol: true,
    });

  const earnings = breakdownOr(payslip.earningsBreakdown, [
    ["Basic Salary", payslip.grossAmount],
    ["Bonus", payslip.bonusAmount],
    ["Other additions", payslip.otherAdditions],
  ]);

  /**
   * The tax is always its own line, appended to whatever was described.
   *
   * The breakdown covers the deductions somebody entered — an advance, unpaid
   * leave. The tax is not one of those: the app works it out, so it cannot be
   * left to a typed list to remember. Without this, filling in a breakdown
   * would drop the tax off the page while leaving it in the total, and the
   * column would stop adding up in the one place it must.
   */
  const deductions = [
    ...breakdownOr(payslip.deductionsBreakdown, [
      [payslip.deductionNote ?? "Other deductions", payslip.otherDeductions],
    ]),
    ...(Number(payslip.tdsAmount) !== 0
      ? [{ label: "Tax deducted at source", amount: payslip.tdsAmount }]
      : []),
  ];

  // The two totals are the line's own figures, never the sum of the lists
  // above. A breakdown is a description of the gross; if somebody types one
  // that does not add up, the payslip must still agree with what was paid and
  // with the salary sheet it came from.
  const grossTotal = sum([
    payslip.grossAmount,
    payslip.bonusAmount,
    payslip.otherAdditions,
  ]);
  const deductionTotal = sum([payslip.tdsAmount, payslip.otherDeductions]);

  const payDate = payslip.paidOn ?? payslip.paymentDate;

  /**
   * The days the salary is for, which is not the day it was paid.
   *
   * The owner asked for "'pay period' hobe jekhane kon tarikh theke kon tarikh
   * er salary take dibo" — two dates, so the run's own label ("August 2026")
   * would not answer the question he asked. `monthRange` is the same helper
   * the rest of the app uses to turn a payroll period into a span, so the
   * payslip cannot disagree with the salary sheet it came from about which
   * days were paid for.
   */
  const period = monthRange(payslip.periodYear, payslip.periodMonth);

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

      <style>{SHEET_CSS}</style>

      <article className="slip" lang="en">
        {/* ---------------------------------------------------------------- */}
        <header className="slip-band">
          <div className="slip-band-inner">
            <div className="slip-brand">
              <span className="slip-mark" aria-hidden="true">
                {initials(settings.companyName)}
              </span>
              <span>
                <span className="slip-brand-name">{settings.companyName}</span>
                {settings.companyTagline ? (
                  <span className="slip-tagline">
                    {settings.companyTagline}
                  </span>
                ) : null}
              </span>
            </div>

            <div className="slip-title">
              <p className="slip-doc">Salary Payslip</p>
              <p className="slip-month">{payslip.runLabel}</p>
              <dl className="slip-meta">
                <div>
                  <dt>Payslip no</dt>
                  <dd>{payslipNumber(payslip)}</dd>
                </div>
                <div>
                  <dt>Pay date</dt>
                  <dd>{payDate ? longDate(payDate) : "Not yet paid"}</dd>
                </div>
              </dl>
            </div>
          </div>

          <p className="slip-legal">
            {[settings.companyName, settings.companyLegalNote]
              .filter(Boolean)
              .join("  ·  ")}
          </p>
          <p className="slip-contact">
            {[
              settings.companyAddress,
              settings.companyWebsite,
              settings.companyEmail,
            ]
              .filter(Boolean)
              .join("   •   ")}
          </p>
        </header>

        {/* ---------------------------------------------------------------- */}
        <section className="slip-card">
          <div className="slip-card-main">
            <p className="slip-label">Employee</p>
            <p className="slip-name">{payslip.fullName}</p>
            <p className="slip-role">
              {[payslip.snapshotDesignation, payslip.snapshotDepartment]
                .filter(Boolean)
                .join("  ·  ") || "N/A"}
            </p>
            <p className="slip-codes">
              {payslip.employeeCode ? (
                <span className="slip-code">{payslip.employeeCode}</span>
              ) : null}
              <span className="slip-chip">
                {ENGAGEMENT_LABELS[payslip.engagementType]}
              </span>
            </p>
          </div>

          <dl className="slip-card-facts">
            <div>
              <dt>Date of joining</dt>
              <dd>{shortDate(payslip.joinedOn)}</dd>
            </div>
            <div>
              <dt>Working days</dt>
              <dd>
                {payslip.workingDays != null
                  ? `${payslip.workingDays} days`
                  : "Full month"}
              </dd>
            </div>
            <div className="slip-card-wide">
              <dt>Bank account</dt>
              <dd>
                {[payslip.snapshotBankName, payslip.snapshotBankAccount]
                  .filter(Boolean)
                  .join("  ·  ") || "N/A"}
              </dd>
            </div>
            {payslip.snapshotEtin ? (
              <div className="slip-card-wide">
                <dt>e-TIN</dt>
                <dd>{payslip.snapshotEtin}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="slip-columns">
          <Column
            heading="Earnings"
            currency={settings.baseCurrency}
            rows={earnings}
            totalLabel="Gross earnings"
            total={grossTotal}
            money={money}
          />
          <Column
            heading="Deductions"
            currency={settings.baseCurrency}
            rows={deductions}
            totalLabel="Total deductions"
            total={deductionTotal}
            money={money}
            negative
          />
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="slip-net">
          <div>
            <p className="slip-net-label">Net payable</p>
            <p className="slip-net-words">
              {settings.baseCurrency} {inWords(payslip.netAmount)}
            </p>
            <p className="slip-net-check">
              Gross {money(grossTotal)}
              {"   ·   "}
              Deductions {money(deductionTotal)}
            </p>
          </div>
          <p className="slip-net-figure">
            <span className="slip-net-ccy">{settings.baseCurrency}</span>
            {money(payslip.netAmount)}
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="slip-payment">
          <p className="slip-label">Payment details</p>
          <dl className="slip-payment-grid">
            <div>
              <dt>Payment mode</dt>
              <dd>
                {PAYMENT_METHOD_LABELS[
                  payslip.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS
                ] ?? payslip.paymentMethod}
              </dd>
            </div>
            {/* The bank account used to be repeated here as "Credited to".
                It is already printed against the employee's name at the top of
                the sheet, and the owner's objection was that saying it twice on
                a one-page document earns nothing: "Bank details to upore ekbar
                achei..repeat kora lagbena". The period the salary covers is the
                fact that was missing, so it takes the slot. */}
            <div>
              <dt>Pay period</dt>
              {/* `longDate`, not the app's `formatDate`.

                  This block prints "31 August 2026" for the payment date
                  immediately beside it, and the file's own header explains why:
                  a payslip is a document that gets printed and signed, so it
                  carries document-grade dates rather than the table format the
                  screens use. Two slashed dates sitting next to a spelled-out
                  one, inside one three-column block, would read as two different
                  kinds of fact. */}
              <dd>
                {longDate(period.start)} to {longDate(period.end)}
              </dd>
            </div>
            <div>
              {/* "Value date" is what a bank calls the day money settles, and
                  the owner's point was that nobody in this office reads it that
                  way. The figure behind the label has not changed. */}
              <dt>Payment Date</dt>
              <dd>{payDate ? longDate(payDate) : "Not yet paid"}</dd>
            </div>
            {payslip.remarks ? (
              <div className="slip-payment-wide">
                <dt>Remarks</dt>
                <dd>{payslip.remarks}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="slip-signatures">
          <div>
            {/*
              The same slot the right-hand block has, whether or not there is a
              mark to put in it.

              The owner's other point about this footer: "payslip er duita same
              height a nei left er ta ektu nice namiye diyo." The right block
              carries 26pt of signature plus a 2pt gap above its rule, and the
              left carried nothing — so the two rules sat 28pt apart on a
              document where they read as a pair. Reserving the height rather
              than shifting the left block down by a magic number means they
              stay level in all four states: neither signed, either one signed,
              or both.
            */}
            {preparedSignature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileHref(preparedSignature)}
                alt=""
                aria-hidden="true"
                className="slip-signature slip-signature-left"
              />
            ) : (
              <span className="slip-signature-gap" aria-hidden="true" />
            )}
            <p className="slip-sign-rule" />
            <p className="slip-label">Prepared by</p>
            <p className="slip-sign-name">
              Accounts &amp; Finance, {settings.companyName}
            </p>
          </div>
          <div>
            {/* Above the rule, where a person signs.
                Fixed height with the width following, so a wide scan cannot
                shove the block sideways and a tall one cannot grow the page.
                26pt of ink plus its 2pt gap is what this costs: the content
                currently ends 49.6pt above the footer, measured, so it stays on
                one A4 sheet with about 21pt still clear. That headroom is the
                reason the height is fixed here rather than left to the file. */}
            {signature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileHref(signature)}
                alt=""
                aria-hidden="true"
                className="slip-signature"
              />
            ) : (
              /* The same reserved height as the left, so an unsigned slip has
                 its two rules level too. */
              <span className="slip-signature-gap" aria-hidden="true" />
            )}
            <p className="slip-sign-rule" />
            <p className="slip-label">Authorised signatory</p>
            <p className="slip-sign-name">
              {[settings.payslipSignatoryName, settings.payslipSignatoryTitle]
                .filter(Boolean)
                .join("  ·  ") || settings.companyName}
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <footer className="slip-footer">
          <div>
            <p className="slip-confidential">Confidential</p>
            <p className="slip-foot-note">
              Intended solely for the named employee. Report any discrepancy to
              Accounts within 7 days.
            </p>
          </div>
          <div className="slip-foot-right">
            <p className="slip-foot-note">
              Computer-generated payslip · no physical signature required.
            </p>
            {settings.companyWebsite ? (
              <p className="slip-foot-site">{settings.companyWebsite}</p>
            ) : null}
          </div>
        </footer>
      </article>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function Column({
  heading,
  currency,
  rows,
  totalLabel,
  total,
  money,
  negative = false,
}: {
  heading: string;
  currency: string;
  rows: PayslipLineDto[];
  totalLabel: string;
  total: string;
  money: (value: string) => string;
  negative?: boolean;
}) {
  return (
    <div className="slip-col">
      <div className="slip-col-head">
        <span>{heading}</span>
        <span className="slip-col-ccy">{currency}</span>
      </div>
      {/* The lime stub and the grey remainder of the underline, as drawn. */}
      <div className="slip-rule" aria-hidden="true">
        <span />
      </div>

      <table className="slip-table">
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="slip-none" colSpan={2}>
                None
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${row.label}-${index}`}>
                <th scope="row">{row.label}</th>
                <td>{money(row.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className={negative ? "slip-total slip-total-out" : "slip-total"}>
        <span>{totalLabel}</span>
        <span>{money(total)}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The stored breakdown, or the old three-figure shape rendered as one.
 *
 * Lines created before the breakdown columns existed have `null` here, and
 * they must still print. The fallback is the same information the previous
 * payslip showed, in the same place — not an empty table.
 */
function breakdownOr(
  stored: PayslipLineDto[] | null,
  fallback: [string, string][],
): PayslipLineDto[] {
  if (stored && stored.length > 0) {
    return stored.filter((row) => Number(row.amount) !== 0);
  }
  return fallback
    .filter(([, amount]) => Number(amount) !== 0)
    .map(([label, amount]) => ({ label, amount }));
}

/**
 * Paisa-exact, because these are money strings and not numbers.
 *
 * The shared minor-unit helpers rather than arithmetic here: 36000.00 +
 * 18000.00 in floating point is not reliably 54000.00, and the two totals on a
 * payslip have to match the salary sheet they came from to the paisa.
 */
function sum(values: string[]): string {
  return fromMinorUnits(
    values.reduce((total, value) => total + toMinorUnits(value), BigInt(0)),
  );
}

/** `PS-2026AUG-0012` — the company's own numbering. */
function payslipNumber(payslip: PayslipDto): string {
  const month = MONTHS[payslip.periodMonth - 1] ?? "";
  const tail = payslip.employeeCode
    ? (payslip.employeeCode.match(/(\d+)\s*$/)?.[1] ?? payslip.employeeCode)
    : payslip.id.slice(0, 4).toUpperCase();
  return `PS-${payslip.periodYear}${month.slice(0, 3).toUpperCase()}-${tail}`;
}

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

/** `31 August 2026`. Parsed by hand — an ISO date is not a moment in time. */
function longDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `15 Jun 2025`. */
function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]?.slice(0, 3)} ${year}`;
}

/**
 * The two letters in the tile at the corner of the band.
 *
 * A run-together name carries its own: "ShareViral" is SV, not S, and taking
 * the first letter of each word would make "ShareViral Bangladesh" into SB —
 * a different company's mark. So a capital inside the first word wins over the
 * second word; only a plainly-spelled name falls back to one letter each.
 */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const inner = words[0]?.match(/[A-Z]/g) ?? [];
  if (inner.length >= 2) return inner.slice(0, 2).join("");
  return (
    words
      .map((word) => word[0]?.toUpperCase() ?? "")
      .slice(0, 2)
      .join("") || "•"
  );
}

/**
 * "Fifty Nine Thousand One Hundred Ninety Two only" — a payslip states the
 * amount in words so a printed figure cannot be quietly altered.
 */
function inWords(value: string): string {
  const [whole, fraction = "00"] = value.split(".");
  const paisa = Number(fraction.padEnd(2, "0").slice(0, 2));
  const words = titleCase(numberToWords(Math.abs(Number(whole))));
  const suffix =
    paisa > 0 ? ` and ${titleCase(numberToWords(paisa))} Paisa` : "";
  return `${words}${suffix} only`;
}

function titleCase(text: string): string {
  return text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
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
    return one ? `${TENS[ten]} ${ONES[one]}` : TENS[ten];
  }
  const hundred = Math.floor(value / 100);
  const remainder = value % 100;
  return remainder
    ? `${ONES[hundred]} hundred ${underThousand(remainder)}`
    : `${ONES[hundred]} hundred`;
}

/* -------------------------------------------------------------------------- */
/*  The sheet                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Scoped rather than in `globals.css`, and in `pt` rather than Tailwind's
 * scale, because this is one printed document with fixed measurements taken
 * off an existing PDF — not a screen that should follow the app's spacing
 * system or the reader's theme.
 */
const SHEET_CSS = `
.slip {
  --slip-ink: #0B0D0A;
  --slip-ink-2: #141713;
  --slip-lime: #BFFF00;
  --slip-paper: #FFFFFF;
  --slip-card: #F7F9F5;
  --slip-line: #E4E7E1;
  --slip-line-2: #C6CCC1;
  --slip-muted: #8A9186;
  --slip-body: #3A3F39;
  --slip-out: #C2410C;

  width: 595.28pt;
  max-width: 100%;
  /* A4, so what is measured on screen is what comes out of the printer. */
  min-height: 841.89pt;
  margin-inline: auto;
  padding-bottom: 58pt;
  position: relative;
  overflow: hidden;
  background: var(--slip-paper);
  color: var(--slip-body);
  font-size: 8.5pt;
  line-height: 1.45;
  letter-spacing: 0.01em;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgb(11 13 10 / 0.08), 0 8px 24px rgb(11 13 10 / 0.10);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* --- the black band ----------------------------------------------------- */
.slip-band {
  min-height: 138pt;
  background: var(--slip-ink);
  color: #FFFFFF;
  padding: 22pt 46pt 0;
  border-bottom: 3.5pt solid var(--slip-lime);
  display: flex;
  flex-direction: column;
}
.slip-band-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24pt;
  flex: 1;
}
.slip-brand { display: flex; align-items: center; gap: 10pt; }
.slip-mark {
  display: grid;
  place-items: center;
  width: 30pt;
  height: 30pt;
  flex: none;
  border-radius: 6pt;
  background: var(--slip-lime);
  color: var(--slip-ink);
  font-size: 12pt;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.slip-brand-name {
  display: block;
  font-size: 13pt;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #FFFFFF;
}
.slip-tagline {
  display: block;
  margin-top: 2pt;
  font-size: 6pt;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--slip-lime);
}
.slip-title { text-align: right; }
.slip-doc {
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--slip-lime);
}
.slip-month {
  margin-top: 2pt;
  font-size: 15pt;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  color: #FFFFFF;
}
.slip-meta {
  margin-top: 7pt;
  display: flex;
  justify-content: flex-end;
  gap: 16pt;
  font-size: 6.5pt;
}
.slip-meta div { display: flex; gap: 5pt; align-items: baseline; }
.slip-meta dt {
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #8A9186;
}
.slip-meta dd {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #FFFFFF;
}
.slip-legal {
  margin-top: 14pt;
  font-size: 6.5pt;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #C9D2C2;
}
.slip-contact {
  margin: 2pt 0 12pt;
  font-size: 6.5pt;
  letter-spacing: 0.04em;
  color: #7C857A;
}

/* --- the employee card -------------------------------------------------- */
.slip-card {
  margin: 30pt 46pt 0;
  min-height: 96pt;
  background: var(--slip-card);
  border: 0.75pt solid var(--slip-line);
  border-left: 3.5pt solid var(--slip-lime);
  padding: 14pt 18pt;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24pt;
}
.slip-label {
  font-size: 6pt;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--slip-muted);
}
.slip-name {
  margin-top: 4pt;
  font-size: 14pt;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--slip-ink);
}
.slip-role { margin-top: 1pt; font-size: 8pt; color: var(--slip-body); }
.slip-codes { margin-top: 8pt; display: flex; align-items: center; gap: 6pt; }
.slip-code {
  font-size: 7.5pt;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  color: var(--slip-ink);
}
.slip-chip {
  border: 0.75pt solid var(--slip-line-2);
  border-radius: 999px;
  padding: 1.5pt 6pt;
  font-size: 5.5pt;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--slip-body);
}
.slip-card-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8pt 20pt;
  min-width: 220pt;
  text-align: right;
}
.slip-card-wide { grid-column: 1 / -1; }
.slip-card-facts dt {
  font-size: 5.5pt;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--slip-muted);
}
.slip-card-facts dd {
  margin-top: 1pt;
  font-size: 8pt;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--slip-ink);
}

/* --- earnings and deductions -------------------------------------------- */
.slip-columns {
  margin: 21.5pt 46pt 0;
  display: grid;
  grid-template-columns: 238.64pt 238.64pt;
  justify-content: space-between;
  gap: 26pt;
}
/* Both totals on one line, however many rows are above them — which is what
   the original does, and what makes the two columns readable as a pair. */
.slip-col { min-width: 0; display: flex; flex-direction: column; }
.slip-col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--slip-ink);
}
.slip-col-ccy { color: var(--slip-muted); letter-spacing: 0.14em; }
.slip-rule {
  margin-top: 5pt;
  height: 2.4pt;
  background: var(--slip-line);
}
.slip-rule span { display: block; width: 26pt; height: 100%; background: var(--slip-lime); }
.slip-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 3pt;
  margin-bottom: 7pt;
}
.slip-table th {
  text-align: left;
  font-weight: 400;
  padding: 4.5pt 0;
  color: var(--slip-body);
  border-bottom: 0.5pt solid var(--slip-line);
}
.slip-table td {
  text-align: right;
  padding: 4.5pt 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--slip-ink);
  border-bottom: 0.5pt solid var(--slip-line);
  white-space: nowrap;
}
.slip-none { text-align: left !important; font-weight: 400 !important; color: var(--slip-muted) !important; }
.slip-total {
  /* Auto rather than a fixed gap: it drops the total to the foot of whichever
     column is taller, without stretching the rows above it apart. */
  margin-top: auto;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-top: 1pt solid var(--slip-ink);
  align-self: stretch;
  padding-top: 5pt;
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--slip-ink);
}
.slip-total span:last-child {
  font-size: 9.5pt;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
.slip-total-out span:last-child { color: var(--slip-out); }

/* --- net payable -------------------------------------------------------- */
.slip-net {
  margin: 22pt 46pt 0;
  min-height: 74pt;
  background: var(--slip-ink-2);
  border-left: 3.5pt solid var(--slip-lime);
  padding: 14pt 20pt;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20pt;
  color: #FFFFFF;
}
.slip-net-label {
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--slip-lime);
}
.slip-net-words {
  margin-top: 5pt;
  max-width: 300pt;
  font-size: 8pt;
  font-weight: 600;
  color: #FFFFFF;
}
.slip-net-check {
  margin-top: 4pt;
  font-size: 6.5pt;
  font-variant-numeric: tabular-nums;
  color: #8A9186;
  white-space: pre;
}
.slip-net-figure {
  font-size: 24pt;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: #FFFFFF;
}
.slip-net-ccy {
  display: block;
  text-align: right;
  font-size: 7pt;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--slip-lime);
}

/* --- payment details and signatures ------------------------------------- */
.slip-payment { margin: 24pt 46pt 0; }
.slip-payment-grid {
  margin-top: 8pt;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10pt 20pt;
}
.slip-payment-wide { grid-column: 1 / -1; }
.slip-payment-grid dt {
  font-size: 5.5pt;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--slip-muted);
}
.slip-payment-grid dd {
  margin-top: 2pt;
  font-size: 8pt;
  font-weight: 600;
  color: var(--slip-ink);
}
/* The left block's mark sits over its own rule, which is left-aligned. */
.slip-signature-left { margin: 0 auto 2pt 0; }

/*
 * An empty slot the exact height of a signature.
 *
 * Both blocks reserve it, so the two rules are level whether either has been
 * signed. Written as a box rather than as padding on the rule, because the
 * rule is a shared class and giving it a top margin would move it on the
 * statement's signature block too.
 */
.slip-signature-gap {
  display: block;
  height: 26pt;
  margin-bottom: 2pt;
}

.slip-signature {
  display: block;
  height: 26pt;
  width: auto;
  max-width: 100%;
  /* Rightward, over the rule it belongs to. */
  margin: 0 0 2pt auto;
  object-fit: contain;
}
.slip-signatures {
  margin: 40pt 46pt 30pt;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 40pt;
}
.slip-signatures > div:last-child { text-align: right; }
.slip-sign-rule {
  height: 0;
  border-top: 0.75pt solid var(--slip-line-2);
  margin-bottom: 5pt;
}
.slip-sign-name { margin-top: 2pt; font-size: 8pt; font-weight: 600; color: var(--slip-ink); }

/* --- the footer band ---------------------------------------------------- */
.slip-footer {
  position: absolute;
  inset: auto 0 0;
  min-height: 58pt;
  background: var(--slip-ink);
  border-top: 2.5pt solid var(--slip-lime);
  padding: 11pt 46pt;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20pt;
}
.slip-confidential {
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--slip-lime);
}
.slip-foot-note { margin-top: 2pt; font-size: 6pt; color: #7C857A; max-width: 260pt; }
.slip-foot-right { text-align: right; }
.slip-foot-site {
  margin-top: 2pt;
  font-size: 6.5pt;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #C9D2C2;
}

/* --- narrow screens ----------------------------------------------------- */
@media (max-width: 640px) {
  .slip-band, .slip-card, .slip-columns, .slip-net,
  .slip-payment, .slip-signatures, .slip-footer {
    padding-inline: 20pt;
  }
  .slip-card, .slip-columns, .slip-net, .slip-signatures, .slip-footer {
    margin-inline: 0;
  }
  .slip-band-inner, .slip-card, .slip-net, .slip-footer { flex-direction: column; }
  .slip-title, .slip-card-facts, .slip-foot-right,
  .slip-signatures > div:last-child { text-align: left; }
  .slip-meta { justify-content: flex-start; }
  .slip-columns { grid-template-columns: minmax(0, 1fr); }
  .slip-payment-grid, .slip-signatures { grid-template-columns: minmax(0, 1fr); }
}

/* --- print -------------------------------------------------------------- */
@media print {
  @page { size: A4; margin: 0; }
  .slip {
    width: 100%;
    min-height: 297mm;
    border-radius: 0;
    box-shadow: none;
    padding-bottom: 58pt;
  }
  .slip-footer { position: fixed; }
}
`;
