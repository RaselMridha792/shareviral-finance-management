"use client";

import type { TdsResult } from "@finance/shared";

import { Amount } from "@/components/money/amount";

/**
 * The whole sum, step by step.
 *
 * One component rather than two, because it is shown in two places that must
 * not diverge: the calculator in Settings, where somebody checks the app
 * against a piece of paper, and a person's line on the salary sheet, where
 * somebody asks why that month deducted what it did. If the two rendered the
 * working differently, the check would prove nothing.
 *
 * Every intermediate figure is shown. "1,750" on its own cannot be checked
 * against anything — the point of the page is the arithmetic, not the answer.
 */
export function TdsWorking({ result }: { result: TdsResult }) {
  return (
    <div className="rounded-lg border border-border">
      <WorkingLine label="Total salary income" value={result.annualSalary} />
      <WorkingLine
        label={`Less exempted — ${result.exemption.byFraction} by fraction, cap ${result.exemption.cap}`}
        value={`-${result.exemption.applied}`}
      />
      <WorkingLine label="Net taxable income" value={result.taxableIncome} strong />

      {result.bands.map((band, index) => (
        <WorkingLine
          key={index}
          label={`${band.label} @ ${formatRate(band.rate)}  — on ${band.amount}`}
          value={band.tax}
          muted
        />
      ))}
      <WorkingLine label="Tax before rebate" value={result.taxBeforeRebate} strong />

      <WorkingLine
        label={`Rebate — on investment ${result.rebate.onInvestment}, on income ${result.rebate.onTaxableIncome}, ceiling ${result.rebate.fixedCap}`}
        value={`-${result.rebate.applied}`}
      />
      <WorkingLine label="Tax after rebate" value={result.taxAfterRebate} />

      {result.minimumTaxApplied ? (
        <WorkingLine
          label="Minimum tax applied — the rebate had taken it below the floor"
          value={result.minimumTaxApplied}
          muted
        />
      ) : null}

      <WorkingLine
        label="Net payable tax, for the year"
        value={result.netAnnualTax}
        strong
      />
      <div className="flex items-baseline justify-between gap-4 bg-surface-muted px-4 py-3">
        <span className="text-sm font-semibold">Monthly TDS</span>
        <Amount
          value={result.monthlyTds}
          showCounterpart={false}
          className="text-lg font-semibold"
        />
      </div>
    </div>
  );
}

/** `15%`, but `12.5%` when it needs the place. */
function formatRate(rate: number): string {
  const percent = rate * 100;
  return `${percent.toFixed(percent % 1 ? 2 : 0)}%`;
}

export function WorkingLine({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
      <span
        className={
          muted
            ? "text-xs text-muted-foreground"
            : "text-sm text-muted-foreground"
        }
      >
        {label}
      </span>
      <Amount
        value={value}
        showCounterpart={false}
        className={strong ? "font-semibold" : muted ? "text-xs" : ""}
      />
    </div>
  );
}
