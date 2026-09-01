"use client";

import { formatMoney, monthRange, todayInDhaka } from "@finance/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/components/settings-provider";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ledgerApi, type ExpenseOverview } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { MonthPicker, type Range } from "./month-picker";

/**
 * A month's spending, in slices that add up.
 *
 * The owner asked for a new overview page with at least six dynamic boxes,
 * Salary among them. The first plan for it gave him six that counted the same
 * money five times — salary sat inside Operational expenses, inside Other
 * expenses and inside the headline, so "Other expenses" read HIGHER than
 * "Operational expenses" beside it. Shown both shapes, he chose the one that
 * adds up.
 *
 * So the arithmetic is the design:
 *
 *     Salary + Tooling + Operational + Uncategorised  =  Spent this month
 *
 * and the page SAYS SO, under the boxes, with the sum written out. A dashboard
 * that claims a total is a dashboard somebody will check; one that shows its
 * working is one they can stop checking.
 *
 * **Tax withheld sits outside that sum**, in its own box, labelled as held
 * rather than spent. It is in the account and it is not the company's to spend,
 * which is a different fact from every other figure here — folding it in would
 * make the total wrong in the one direction that matters.
 */
export function ExpenseOverviewScreen() {
  const settings = useSettings();
  const [range, setRange] = useState<Range>(() => {
    const today = todayInDhaka();
    const month = monthRange(
      Number(today.slice(0, 4)),
      Number(today.slice(5, 7)),
    );
    return { from: month.start, to: month.end, label: month.label };
  });
  const [data, setData] = useState<ExpenseOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await ledgerApi.expenseOverview({ from: range.from, to: range.to }),
      );
    } catch {
      setError("Could not load the overview.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const money = (value: string) =>
    formatMoney(value, {
      currency: settings.baseCurrency,
      format: settings.numberFormat,
    });

  const slices = data
    ? [
        {
          key: "salary",
          label: "Salary",
          value: data.salary,
          was: data.previous.salary,
          href: "/payroll",
          note: "Net pay that left the bank",
        },
        {
          key: "tooling",
          label: "AI tools and subscriptions",
          value: data.tooling,
          was: data.previous.tooling,
          href: "/subscriptions",
          note: "Paid to a tool vendor, or on the card that buys tools",
        },
        {
          key: "operational",
          label: "Operational expenses",
          value: data.operational,
          was: data.previous.operational,
          href: "/expenses",
          note: "Everything else with a heading on it",
        },
        {
          key: "uncategorised",
          label: "Uncategorised",
          value: data.uncategorised,
          was: data.previous.uncategorised,
          href: "/expenses/other",
          /* The one box that exists to be emptied. The category grid
             inner-joins categories, so money with no heading appears nowhere
             else in this app at all. */
          note: "Money out with no heading — the grid cannot show these",
        },
      ]
    : [];

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      <PageHeader
        title="Expense overview"
        icon="grid_view"
        description="Where the month's money went, in slices that add up."
        actions={<MonthPicker range={range} onChange={setRange} />}
      />

      {/* The headline the four add to. */}
      <Card>
        <CardBody className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Spent in {range.label}
            </p>
            <p className="col-amount mt-1 text-2xl font-semibold">
              {data ? money(data.total) : loading ? "…" : money("0")}
            </p>
          </div>
          {data ? (
            <Change
              now={data.total}
              was={data.previous.total}
              label={data.previous.label}
            />
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {slices.map((slice) => (
          <Link
            key={slice.key}
            href={slice.href}
            className="group rounded-xl border border-border bg-surface p-4 transition hover:border-link"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {slice.label}
            </p>
            <p className="col-amount mt-1.5 text-xl font-semibold">
              {money(slice.value)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{slice.note}</p>
            <div className="mt-2">
              <Change
                now={slice.value}
                was={slice.was}
                label={data?.previous.label ?? ""}
              />
            </div>
          </Link>
        ))}
      </div>

      {/*
        The working, written out.

        A total nobody can check is a total people go on checking by hand. This
        is the sentence that stops that — and it is also the page's own test: if
        the four ever stop adding to the headline, it says so here rather than
        looking plausible.
      */}
      {data ? (
        <p className="text-xs text-muted-foreground">
          {money(data.salary)} + {money(data.tooling)} +{" "}
          {money(data.operational)} + {money(data.uncategorised)} ={" "}
          <span className="font-medium text-foreground">
            {money(data.total)}
          </span>
          . Every taka the company spent this month is in exactly one of the
          four — transfers between our own accounts are not spending and are not
          counted.
        </p>
      ) : null}

      {/*
        Held, not spent — which is why it is outside the four and outside the
        total. It is in the account and it is not the company's to spend.
      */}
      <Card>
        <CardBody className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Tax withheld
            </p>
            <p className="col-amount mt-1 text-lg font-semibold">
              {data ? money(data.withheld) : money("0")}
            </p>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            Deducted from what was paid out and still to be deposited. It sits
            in the account but it is not the company&rsquo;s to spend, so it is
            not part of the figures above.{" "}
            <Link
              href="/tax/withholding"
              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              The withholding register
            </Link>{" "}
            has it person by person.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

/**
 * How a figure compares with the month before.
 *
 * Percentages only where they mean something: from zero, every increase is
 * infinite, and "+∞%" on a finance screen is a number somebody will try to read.
 */
function Change({
  now,
  was,
  label,
}: {
  now: string;
  was: string;
  label: string;
}) {
  const a = Number(now);
  const b = Number(was);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  if (b === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {a === 0 ? `Nothing in ${label} either` : `Nothing in ${label}`}
      </span>
    );
  }

  const percent = ((a - b) / b) * 100;
  const rounded = Math.round(percent);
  if (rounded === 0) {
    return (
      <span className="text-xs text-muted-foreground">Level with {label}</span>
    );
  }
  return (
    <span
      className={cn(
        "text-xs",
        /* Up is not "bad" and down is not "good" — this is spending, and the
           right amount depends on the month. Muted on purpose: the colour would
           be an opinion the page has no basis for. */
        "text-muted-foreground",
      )}
    >
      {rounded > 0 ? "+" : ""}
      {rounded}% vs {label}
    </span>
  );
}
