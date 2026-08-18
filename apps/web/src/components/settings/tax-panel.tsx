"use client";

import type { TdsPolicy } from "@finance/shared";
import { Calculator, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { taxPolicyApi, type TdsCalculation } from "@/lib/tax-policy";

/**
 * The salary TDS rule, and a calculator to check it against a piece of paper.
 *
 * The app works the tax out now rather than taking a figure somebody typed, so
 * this screen decides what every payslip deducts. Two things follow from that:
 *
 *  - The rule is edited per income year, never in place. Changing 2026 does not
 *    reach back into a 2025 payslip.
 *  - The calculator shows every step rather than the answer. The answer alone
 *    cannot be checked against the advisor's working, and checking it against
 *    the advisor's working is the entire reason it is here.
 */
export function TaxPanel() {
  const canWrite = useCan("settings.write");
  const toast = useToast();

  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [policy, setPolicy] = useState<TdsPolicy | null>(null);
  const [exact, setExact] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    taxPolicyApi
      .years()
      .then((list) => {
        if (!live) return;
        setYears(list);
        setYear(list[0] ?? new Date().getFullYear());
      })
      .catch(() => {
        if (live) setError("Could not read which years have a rule.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (year === null) return;
    let live = true;
    taxPolicyApi
      .forYear(year)
      .then((r) => {
        if (!live) return;
        setPolicy(r.policy);
        setExact(r.exact);
      })
      .catch((caught) => {
        if (!live) return;
        setError(
          caught instanceof ApiError ? caught.message : "Could not read the rule.",
        );
      });
    return () => {
      live = false;
    };
  }, [year]);

  async function save() {
    if (!policy || year === null) return;
    setSaving(true);
    setError(null);
    try {
      // The year is the path segment, so the body must not carry one — a
      // payload claiming a year the URL disagrees with is refused by the
      // schema rather than quietly writing to the wrong one.
      await taxPolicyApi.save(year, {
        exemptionNumerator: policy.exemptionNumerator,
        exemptionDenominator: policy.exemptionDenominator,
        exemptionCap: policy.exemptionCap,
        slabs: policy.slabs,
        rebate: policy.rebate,
        minimumTax: policy.minimumTax,
        minimumTaxEnabled: policy.minimumTaxEnabled,
      });
      toast.show(`TDS rule saved for ${label(year)}.`);
      const fresh = await taxPolicyApi.forYear(year);
      setPolicy(fresh.policy);
      setExact(fresh.exact);
      setYears((list) => (list.includes(year) ? list : [year, ...list]));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not save the rule.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!policy) {
    return (
      <Card>
        <CardBody className="flex items-center gap-2 text-sm text-muted-foreground">
          {error ? (
            <span className="text-negative">{error}</span>
          ) : (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Reading the TDS rule…
            </>
          )}
        </CardBody>
      </Card>
    );
  }

  const set = (patch: Partial<TdsPolicy>) =>
    setPolicy({ ...policy, ...patch });
  const setRebate = (patch: Partial<TdsPolicy["rebate"]>) =>
    setPolicy({ ...policy, rebate: { ...policy.rebate, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Salary TDS"
          description="What the app deducts, and how it works it out. One rule per income year."
          action={
            <select
              value={year ?? ""}
              onChange={(event) => setYear(Number(event.target.value))}
              className="h-9 rounded-lg border border-border bg-surface-muted px-3 text-sm"
            >
              {[...new Set([...years, year ?? 0])]
                .filter(Boolean)
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={y}>
                    {label(y)}
                  </option>
                ))}
            </select>
          }
        />
        <CardBody className="flex flex-col gap-5">
          {!exact ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                No rule has been set for {label(year ?? 0)}. The figures below
                are {label(policy.fiscalYear)}&apos;s, which is what would be
                used — saving here writes a rule for {label(year ?? 0)} of its
                own.
              </span>
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
              {error}
            </p>
          ) : null}

          {/* ------------------------------------------------- exemption */}
          <section>
            <h3 className="text-sm font-semibold">Exemption</h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              The untaxed share of salary: a fraction of it, or the cap —
              whichever is lower.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/*
                A numerator and a denominator rather than "33.33%". One third
                has no exact decimal, and carrying 0.3333 through paisa made a
                5,40,000 salary come out eighteen paisa wrong — which the
                advisor's own worked examples caught.
              */}
              <Field label="Fraction — top" hint="1 of 1/3">
                <Input
                  type="number"
                  min={0}
                  value={policy.exemptionNumerator}
                  disabled={!canWrite}
                  onChange={(e) =>
                    set({ exemptionNumerator: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Fraction — bottom" hint="3 of 1/3">
                <Input
                  type="number"
                  min={1}
                  value={policy.exemptionDenominator}
                  disabled={!canWrite}
                  onChange={(e) =>
                    set({ exemptionDenominator: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Cap" hint="Whichever is lower applies">
                <Input
                  className="col-amount"
                  value={policy.exemptionCap}
                  disabled={!canWrite}
                  onChange={(e) => set({ exemptionCap: e.target.value })}
                />
              </Field>
            </div>
          </section>

          {/* ----------------------------------------------------- slabs */}
          <section>
            <h3 className="text-sm font-semibold">Slabs</h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              Applied in order to the taxable income. The last band has no
              width and takes everything above.
            </p>
            <div className="flex flex-col gap-2">
              {policy.slabs.map((band, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">
                    {band.width === null
                      ? "Remainder"
                      : index === 0
                        ? "First"
                        : "Next"}
                  </span>
                  <Input
                    className="col-amount"
                    placeholder={band.width === null ? "everything above" : ""}
                    value={band.width ?? ""}
                    disabled={!canWrite || band.width === null}
                    onChange={(e) => {
                      const slabs = [...policy.slabs];
                      slabs[index] = { ...band, width: e.target.value };
                      set({ slabs });
                    }}
                  />
                  <div className="flex w-32 shrink-0 items-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      className="col-amount"
                      value={(band.rate * 100).toString()}
                      disabled={!canWrite}
                      onChange={(e) => {
                        const slabs = [...policy.slabs];
                        slabs[index] = {
                          ...band,
                          rate: Number(e.target.value) / 100,
                        };
                        set({ slabs });
                      }}
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------------------------------------------- rebate */}
          <section>
            <h3 className="text-sm font-semibold">Investment rebate</h3>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">
              The lowest of three: a share of the eligible investment, a share
              of taxable income, and a flat ceiling.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/*
                Two rates, not the 3.75% they come to. Collapsed, the figure
                would not move when either is changed here — and moving it is
                the reason these are settings at all.
              */}
              <Field
                label="Eligible investment"
                hint="As a share of taxable income"
              >
                <Percent
                  value={policy.rebate.investmentRate}
                  disabled={!canWrite}
                  onChange={(investmentRate) => setRebate({ investmentRate })}
                />
              </Field>
              <Field label="Rebate on that investment">
                <Percent
                  value={policy.rebate.rebateRate}
                  disabled={!canWrite}
                  onChange={(rebateRate) => setRebate({ rebateRate })}
                />
              </Field>
              <Field label="Or this share of taxable income">
                <Percent
                  value={policy.rebate.taxableShareCap}
                  disabled={!canWrite}
                  onChange={(taxableShareCap) => setRebate({ taxableShareCap })}
                />
              </Field>
              <Field label="Or this ceiling, whichever is lowest">
                <Input
                  className="col-amount"
                  value={policy.rebate.fixedCap}
                  disabled={!canWrite}
                  onChange={(e) => setRebate({ fixedCap: e.target.value })}
                />
              </Field>
            </div>

            <Toggle
              className="mt-4"
              checked={policy.rebate.assumeFullInvestment}
              disabled={!canWrite}
              onChange={(assumeFullInvestment) =>
                setRebate({ assumeFullInvestment })
              }
              title="Treat everybody as having invested the full amount"
              description="On, everybody gets the rebate whether or not they invested — which is generous and deliberate. Off, only somebody with a declared investment does, and the rest pay the full tax."
            />
          </section>

          {/* --------------------------------------------------- minimum */}
          <section>
            <h3 className="text-sm font-semibold">Minimum tax</h3>
            <Toggle
              className="mt-3"
              checked={policy.minimumTaxEnabled}
              disabled={!canWrite}
              onChange={(minimumTaxEnabled) => set({ minimumTaxEnabled })}
              title="Apply a floor to anybody who is a taxpayer"
              description="Only above the first band. Somebody whose income is under the threshold owes nothing, not the minimum."
            />
            {policy.minimumTaxEnabled ? (
              <Field label="Amount" className="mt-3 max-w-xs">
                <Input
                  className="col-amount"
                  value={policy.minimumTax}
                  disabled={!canWrite}
                  onChange={(e) => set({ minimumTax: e.target.value })}
                />
              </Field>
            ) : null}
          </section>

          {canWrite ? (
            <div className="flex justify-end border-t border-border pt-4">
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Save the rule for {label(year ?? 0)}
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <TdsCalculator year={year ?? 0} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Check the rule against a piece of paper.
 *
 * Every step is shown, in the order the advisor writes them, because a single
 * figure cannot be checked against anything. This is what somebody uses to
 * satisfy themselves the app agrees with the accountant before a payroll run
 * depends on it.
 */
function TdsCalculator({ year }: { year: number }) {
  const [salary, setSalary] = useState("");
  const [investment, setInvestment] = useState("");
  const [result, setResult] = useState<TdsCalculation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await taxPolicyApi.calculate({
          annualSalary: salary.replace(/[,\s৳]/g, ""),
          fiscalYear: year,
          declaredInvestment: investment
            ? investment.replace(/[,\s৳]/g, "")
            : undefined,
        }),
      );
    } catch (caught) {
      setResult(null);
      setError(
        caught instanceof ApiError ? caught.message : "Could not calculate.",
      );
    } finally {
      setBusy(false);
    }
  }

  const r = result?.result;

  return (
    <Card>
      <CardHeader
        title="Check a figure"
        description="Run one salary through the rule above and see every step."
      />
      <CardBody className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <Field label="Annual salary" className="min-w-48 flex-1">
            <Input
              className="col-amount"
              placeholder="1200000"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Declared investment"
            className="min-w-48 flex-1"
            hint="Only read when the assumption above is off"
          >
            <Input
              className="col-amount"
              placeholder="0"
              value={investment}
              onChange={(e) => setInvestment(e.target.value)}
            />
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
          <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        ) : null}

        {r ? (
          <div className="rounded-lg border border-border">
            <Line label="Total salary income" value={r.annualSalary} />
            <Line
              label={`Less exempted — ${r.exemption.byFraction} by fraction, cap ${r.exemption.cap}`}
              value={`-${r.exemption.applied}`}
            />
            <Line label="Net taxable income" value={r.taxableIncome} strong />

            {r.bands.map((band, i) => (
              <Line
                key={i}
                label={`${band.label} @ ${(band.rate * 100).toFixed(band.rate * 100 % 1 ? 2 : 0)}%  — on ${band.amount}`}
                value={band.tax}
                muted
              />
            ))}
            <Line label="Tax before rebate" value={r.taxBeforeRebate} strong />

            <Line
              label={`Rebate — on investment ${r.rebate.onInvestment}, on income ${r.rebate.onTaxableIncome}, ceiling ${r.rebate.fixedCap}`}
              value={`-${r.rebate.applied}`}
            />
            <Line label="Tax after rebate" value={r.taxAfterRebate} />

            {r.minimumTaxApplied ? (
              <Line
                label="Minimum tax applied — the rebate had taken it below the floor"
                value={r.minimumTaxApplied}
                muted
              />
            ) : null}

            <Line label="Net payable tax, for the year" value={r.netAnnualTax} strong />
            <div className="flex items-baseline justify-between gap-4 bg-surface-muted px-4 py-3">
              <span className="text-sm font-semibold">Monthly TDS</span>
              <Amount
                value={r.monthlyTds}
                showCounterpart={false}
                className="text-lg font-semibold"
              />
            </div>
          </div>
        ) : null}

        {result && !result.exact ? (
          <p className="text-xs text-muted-foreground">
            Worked out under {label(result.policy.fiscalYear)}&apos;s rule —{" "}
            {label(year)} has none of its own.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function Line({
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
          muted ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"
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

/** A rate, typed as a percentage and stored as a fraction. */
function Percent({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        className="col-amount"
        value={(value * 100).toString()}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="text-sm text-muted-foreground">%</span>
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  title,
  description,
  className,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <label className={`flex items-start gap-3 ${className ?? ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0"
      />
      <span className="text-sm">
        <span className="font-medium">{title}</span>{" "}
        {checked ? <Badge tone="positive">on</Badge> : <Badge>off</Badge>}
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

/** 2026 reads as 2026-27, which is how everybody here says it. */
function label(fiscalYear: number): string {
  return `${fiscalYear}-${String(fiscalYear + 1).slice(2)}`;
}
