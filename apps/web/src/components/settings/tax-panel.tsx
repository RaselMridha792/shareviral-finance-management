"use client";

import { CalculatorIcon } from "@phosphor-icons/react/dist/ssr/Calculator";
import { FloppyDiskIcon } from "@phosphor-icons/react/dist/ssr/FloppyDisk";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import {
  DEFAULT_TDS_POLICY,
  TDS_EXEMPTION_MODES,
  TDS_EXEMPTION_MODE_LABELS,
  type TdsExemptionMode,
  type TdsPolicy,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useCan } from "@/components/auth/session-provider";
import { TdsWorking } from "@/components/tds/tds-working";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { SwitchRow } from "@/components/ui/switch";
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
  /** True while the form holds a default nobody has saved yet. */
  const [unsaved, setUnsaved] = useState(false);

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
        /*
         * No rule at all is a first day, not a failure.
         *
         * A database with no `tax_policies` row made this panel print the
         * API's message and nothing else — and the message pointed at
         * "Settings → Tax", a tab that does not exist. So the one screen that
         * can create the first rule refused to draw the form that creates it,
         * and every new installation arrived unable to deduct any tax at all.
         *
         * The form opens on the app's own default instead. The figures are
         * not authority — they are a starting shape, and the notice above them
         * says so: nothing is saved until somebody has checked them against
         * this year's circular and pressed the button.
         */
        if (caught instanceof ApiError && caught.status === 404) {
          setPolicy({ ...DEFAULT_TDS_POLICY, fiscalYear: year });
          setExact(true);
          setUnsaved(true);
          setError(null);
          return;
        }
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Could not read the rule.",
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
        exemptionMode: policy.exemptionMode,
        slabs: policy.slabs,
        rebate: policy.rebate,
        minimumTax: policy.minimumTax,
        minimumTaxEnabled: policy.minimumTaxEnabled,
      });
      toast.show(`TDS rule saved for ${label(year)}.`);
      const fresh = await taxPolicyApi.forYear(year);
      setPolicy(fresh.policy);
      setUnsaved(false);
      setExact(fresh.exact);
      setYears((list) => (list.includes(year) ? list : [year, ...list]));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the rule.",
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

  const set = (patch: Partial<TdsPolicy>) => setPolicy({ ...policy, ...patch });
  const setRebate = (patch: Partial<TdsPolicy["rebate"]>) =>
    setPolicy({ ...policy, rebate: { ...policy.rebate, ...patch } });

  return (
    <div className="flex flex-col gap-4">
      {unsaved ? (
        <Card className="sv-warn-note bg-(--sv-warn-tint) px-5 py-4">
          <p className="flex items-start gap-2.5 text-sm">
            <WarningIcon
              weight="duotone"
              size={18}
              className="mt-px flex-none text-(--sv-warn)"
            />
            <span>
              <strong>No rule is saved yet — nothing is deducted.</strong> The
              figures below are this app&apos;s defaults, not this year&apos;s
              circular. Check every band, the exemption and the minimum tax
              against the NBR&apos;s own document, then save.
              <span className="mt-1 block text-(--sv-muted)">
                Until it is saved, payroll cannot work out a single deduction —
                a salary paid now is a salary paid without tax withheld.
              </span>
            </span>
          </p>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Salary TDS"
          icon={PercentIcon}
          description="What the app deducts, and how it works it out. One rule per income year."
          action={
            <Select
              aria-label="Income year"
              value={year ?? ""}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-auto"
            >
              {[...new Set([...years, year ?? 0])]
                .filter(Boolean)
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={y}>
                    {label(y)}
                  </option>
                ))}
            </Select>
          }
        />
        {/* A container, so the field grids go four across by the card's own
            width — the sidebar can be open or shut. */}
        <CardBody className="@container flex flex-col gap-5.5">
          {!exact ? (
            <p className="sv-warn-note flex items-start gap-2.5 rounded-[11px] bg-(--sv-warn-tint) px-4 py-3 text-sm">
              <WarningIcon
                weight="duotone"
                size={18}
                className="mt-px flex-none text-(--sv-warn)"
              />
              <span>
                No rule has been set for {label(year ?? 0)}. The figures below
                are {label(policy.fiscalYear)}&apos;s, which is what would be
                used — saving here writes a rule for {label(year ?? 0)} of its
                own.
              </span>
            </p>
          ) : null}

          {error ? (
            <p className="rounded-[11px] bg-(--sv-neg-tint) px-4 py-3 text-sm text-(--sv-neg)">
              {error}
            </p>
          ) : null}

          {/* ------------------------------------------------- exemption */}
          <section>
            <SectionHead title="Exemption">
              The untaxed share of salary: a fraction of it, or the cap —
              whichever is lower.
            </SectionHead>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @min-[62rem]:grid-cols-[repeat(3,minmax(0,1fr))_22rem]">
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
              <Field
                label="Cap"
                hint={
                  policy.exemptionMode === "fraction"
                    ? "Not used while the fraction alone applies"
                    : policy.exemptionMode === "cap"
                      ? "This is the exemption, whatever the salary"
                      : "Whichever is lower applies"
                }
              >
                <Input
                  className="col-amount"
                  value={policy.exemptionCap}
                  disabled={!canWrite}
                  onChange={(e) => set({ exemptionCap: e.target.value })}
                />
              </Field>

              {/*
                Which of the two applies.
                The Act's wording on this moves most years, and an app that can
                only express one reading of it is one that goes quietly wrong the
                year it changes. The default is what the company's accountant
                works to.
              */}
              <Field
                label="Which one applies"
                hint="Change this only against the year's own rule"
              >
                <Select
                  value={policy.exemptionMode}
                  disabled={!canWrite}
                  onChange={(e) =>
                    set({
                      exemptionMode: e.target.value as TdsExemptionMode,
                    })
                  }
                >
                  {TDS_EXEMPTION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {TDS_EXEMPTION_MODE_LABELS[mode]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>

          {/* ----------------------------------------------------- slabs */}
          <section>
            <SectionHead title="Slabs">
              Applied in order to the taxable income. The last band has no width
              and takes everything above.
            </SectionHead>
            {/* Capped, because a slab is a five-digit number and the page is
                now the full width of the window: the fields ran eleven hundred
                pixels with the digits parked at the far end, a screen's width
                from the label that names them. */}
            <div className="flex max-w-155 flex-col gap-2">
              {policy.slabs.map((band, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <span className="w-22.5 shrink-0 text-[13px] font-extrabold text-(--sv-muted)">
                    {band.width === null
                      ? "Remainder"
                      : index === 0
                        ? "First"
                        : "Next"}
                  </span>
                  <Input
                    className="col-amount min-w-0 flex-1"
                    placeholder={band.width === null ? "everything above" : ""}
                    value={band.width ?? ""}
                    disabled={!canWrite || band.width === null}
                    onChange={(e) => {
                      const slabs = [...policy.slabs];
                      slabs[index] = { ...band, width: e.target.value };
                      set({ slabs });
                    }}
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      className="col-amount w-18 px-2.5"
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
                    <PercentSign />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ---------------------------------------------------- rebate */}
          <section>
            <SectionHead title="Investment rebate">
              The lowest of three: a share of the eligible investment, a share
              of taxable income, and a flat ceiling.
            </SectionHead>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @min-[64rem]:grid-cols-4">
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

            <SwitchRow
              className="mt-5.5"
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
          {/* The switch row is the section: its title names it, and the
              amount sits at the row's right while the floor is on. On a
              phone-width card the row wraps and the amount drops under the
              words (SwitchRow does that), so there is one box, not two. */}
          <section>
            <SwitchRow
              checked={policy.minimumTaxEnabled}
              disabled={!canWrite}
              onChange={(minimumTaxEnabled) => set({ minimumTaxEnabled })}
              title="Minimum tax — apply a floor to anybody who is a taxpayer"
              description="Only above the first band. Somebody whose income is under the threshold owes nothing, not the minimum."
            >
              {policy.minimumTaxEnabled ? (
                <Input
                  aria-label="Minimum tax amount"
                  className="col-amount w-32.5 bg-(--sv-surface)"
                  value={policy.minimumTax}
                  disabled={!canWrite}
                  onChange={(e) => set({ minimumTax: e.target.value })}
                />
              ) : null}
            </SwitchRow>
          </section>

          {canWrite ? (
            <div className="sv-card-note flex justify-end pt-3">
              <Button
                variant="primary"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <FloppyDiskIcon weight="duotone" size={18} />
                )}
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
        icon={CalculatorIcon}
        description="Run one salary through the rule above and see every step."
      />
      <CardBody className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-start gap-3"
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
          {/* Lined up with the inputs rather than the bottom of the row: only
              the second field has a hint under it, so aligning to the end left
              the two inputs at different heights. The empty line stands where
              a field's label does. */}
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="text-[13px] font-extrabold">
              &nbsp;
            </span>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy}
              className="h-10"
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CalculatorIcon weight="duotone" size={19} />
              )}
              Work it out
            </Button>
          </div>
        </form>

        {error ? (
          <p className="rounded-[11px] bg-(--sv-neg-tint) px-4 py-3 text-sm text-(--sv-neg)">
            {error}
          </p>
        ) : null}

        {r ? <TdsWorking result={r} /> : null}

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
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        step="0.01"
        className="col-amount min-w-0"
        value={(value * 100).toString()}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <PercentSign />
    </div>
  );
}

/** The % after a rate field, violet and bold as the handoff draws it. */
function PercentSign() {
  return <span className="font-extrabold text-(--sv-violet)">%</span>;
}

/** A part of the rule: its name at 15px/800 and what it does under it. */
function SectionHead({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      <p className="mb-2.5 text-[12.5px] text-(--sv-muted)">{children}</p>
    </>
  );
}

/** 2026 reads as 2026-27, which is how everybody here says it. */
function label(fiscalYear: number): string {
  return `${fiscalYear}-${String(fiscalYear + 1).slice(2)}`;
}
