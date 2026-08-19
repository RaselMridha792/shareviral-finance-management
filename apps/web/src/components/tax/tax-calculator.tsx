"use client";

import { fiscalYearLabel, type FiscalYearMode } from "@finance/shared";
import { Calculator, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { TdsWorking } from "@/components/tds/tds-working";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, MoneyInput, Select } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { taxPolicyApi, type TdsCalculation } from "@/lib/tax-policy";

/**
 * What one salary would deduct, on the withholding screen.
 *
 * None of the arithmetic is here. `/tds/policy-calculator` runs the salary
 * through the stored rule for the income year, and `TdsWorking` renders the
 * steps — the same endpoint and the same component behind the Settings tax
 * panel and behind the working shown beside a person's line on the salary
 * sheet. A second calculator written for this page would be a second answer to
 * "what does this salary deduct", and the two would part company the first time
 * a slab moved.
 *
 * What is here is three boxes and a button.
 */
export function TaxCalculator({
  years,
  mode,
}: {
  /** The income years a rule can be read for, newest first. */
  years: number[];
  mode: FiscalYearMode;
}) {
  const [fiscalYear, setFiscalYear] = useState(years[0]);
  const [salary, setSalary] = useState("");
  const [investment, setInvestment] = useState("");
  const [result, setResult] = useState<TdsCalculation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(
        await taxPolicyApi.calculate({
          // Typed the way an amount is read — "12,00,000", sometimes with the
          // taka sign — and sent as the plain figure the API takes.
          annualSalary: salary.replace(/[,\s৳]/g, ""),
          fiscalYear,
          declaredInvestment: investment
            ? investment.replace(/[,\s৳]/g, "")
            : undefined,
        }),
      );
    } catch (caught) {
      // Cleared, not left showing: the previous answer under a red banner reads
      // as the answer to what was just asked.
      setResult(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not work that out.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Tax calculator"
        description="A year's salary in, the monthly deduction out — with every step of the sum, so it can be checked against the accountant's working."
      />
      <CardBody className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => void run(event)}
        >
          <Field
            label="Annual salary"
            required
            className="min-w-48 flex-1"
            hint="A whole year's pay, not a month's"
          >
            <MoneyInput
              autoFocus
              placeholder="1200000"
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
              required
            />
          </Field>
          <Field
            label="Declared investment"
            className="min-w-48 flex-1"
            hint="Leave blank to use the rule's own assumption"
          >
            <MoneyInput
              placeholder="0"
              value={investment}
              onChange={(event) => setInvestment(event.target.value)}
            />
          </Field>
          {/*
            Which year's rule to use, not which year the salary was earned in.
            Rates move between income years, and a figure checked against last
            year's slabs is not wrong — it is an answer to a different question,
            so the question is asked rather than assumed.
          */}
          <Field label="Income year" className="w-44">
            <Select
              value={fiscalYear}
              onChange={(event) => setFiscalYear(Number(event.target.value))}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {fiscalYearLabel(year, mode)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Calculator className="size-4" />
            )}
            Work it out
          </Button>
        </form>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        {result ? <TdsWorking result={result.result} /> : null}

        {/*
          The year asked for has no rule of its own, so an earlier one was used.
          Said out loud: the figure is not wrong, and nobody should discover
          which slabs produced it by reading the database.
        */}
        {result && !result.exact ? (
          <p className="text-xs text-muted-foreground">
            Worked out under {fiscalYearLabel(result.policy.fiscalYear, mode)}
            &apos;s rule — {fiscalYearLabel(fiscalYear, mode)} has none of its
            own.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
