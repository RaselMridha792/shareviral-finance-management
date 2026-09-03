"use client";

import { formatMoney, monthRange, todayInDhaka } from "@finance/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/components/settings-provider";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ShareBar, StatCell, StatStrip } from "@/components/ui/patterns";
import { ledgerApi, type ExpenseOverview } from "@/lib/ledger";
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
 *     Salary + Tooling + Office rent + Operational  =  Spent this month
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

  const usd = (value: string) =>
    formatMoney(value, { currency: "USD", format: "western" });

  /*
   * Heading, amount, equivalent. Nothing else.
   *
   * The first version of this card carried a one-line note under every figure
   * and a "vs August" line under that, and the owner's answer was immediate:
   * *"ekhane ato beshi lekha thakar dorkar nai. sudhu heading. amount and
   * equivalant amound usd/bdt thakbe."* He is right — a box somebody glances at
   * cannot also be a paragraph, and four boxes each explaining themselves is a
   * page nobody reads twice.
   *
   * What the notes said is not lost: each box is a link, and the screen behind
   * it is where the detail belongs.
   */
  const slices = data
    ? [
        {
          key: "salary",
          label: "Salary",
          value: data.salary,
          usd: data.usd?.salary ?? null,
          href: "/payroll",
          icon: "groups",
          /* The dashboard's own tones for the two slices it also shows, so the
             same money is the same colour on both screens. */
          text: "text-chart-1",
          bar: "bg-chart-1",
        },
        {
          key: "tooling",
          label: "AI tools and subscriptions",
          value: data.tooling,
          usd: data.usd?.tooling ?? null,
          href: "/subscriptions",
          icon: "auto_awesome",
          text: "text-chart-6",
          bar: "bg-chart-6",
        },
        {
          key: "rent",
          label: "Office rent",
          value: data.rent,
          usd: data.usd?.rent ?? null,
          /* The heading's own page, by SLUG — `/expenses/[category]` resolves
             `tree.find(node => node.slug === slug)`, and the heading's slug is
             `office-premises`. Office rent is a sub-category, so the chip row
             on that page is where it lands. */
          href: "/expenses/office-premises",
          icon: "home_work",
          text: "text-chart-3",
          bar: "bg-chart-3",
        },
        {
          key: "operational",
          label: "Operational expenses",
          value: data.operational,
          usd: data.usd?.operational ?? null,
          href: "/expenses",
          icon: "receipt_long",
          text: "text-chart-5",
          bar: "bg-chart-5",
        },
      ]
    : [];

  /**
   * A slice's share of the month, for the bar.
   *
   * Guarded against a month that spent nothing: 0/0 is NaN, and a NaN width
   * renders as a bar of no length that reads as a bar somebody broke.
   */
  const shareOf = (value: string) => {
    const whole = Number(data?.total ?? 0);
    if (!Number.isFinite(whole) || whole <= 0) return 0;
    return Number(value) / whole;
  };

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
        <CardBody>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Spent in {range.label}
          </p>
          <p className="col-amount mt-1 text-2xl font-semibold">
            {data ? money(data.total) : loading ? "…" : money("0")}
          </p>
          {data?.usd ? (
            <p className="col-amount text-sm text-muted-foreground">
              {data.usd.exact ? "" : "~ "}
              {usd(data.usd.total)}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/*
        The dashboard's cards, not four bordered boxes of this page's own.

        `StatStrip` + `StatCell` + `ShareBar` are the same three primitives the
        dashboard's expense row is built from, so a slice looks the same
        wherever it is read — one panel with hairline-ruled cells rather than
        four floating cards, which is what the owner meant by *"dashboard a
        jemon card ache onekta oirokom"*.

        The bar carries the proportion the text no longer does: he asked for
        *"sudhu heading, amount and equivalant"* and no paragraph under each
        box, and a length is not a paragraph. Its colour comes from the app's
        chart palette rather than from the semantic tones — green and red mean
        money in and money out here, and every one of these is money out.
      */}
      <StatStrip>
        {slices.map((slice) => (
          <div key={slice.key} className="relative bg-surface">
            <StatCell
              label={slice.label}
              icon={slice.icon}
              iconTone={slice.text}
              value={money(slice.value)}
              secondary={
                slice.usd !== null
                  ? `${data?.usd?.exact ? "" : "~ "}${usd(slice.usd)}`
                  : null
              }
            >
              <ShareBar share={shareOf(slice.value)} tone={slice.bar} />
            </StatCell>
            {/*
              The whole cell is the link, laid over it rather than wrapped
              around it — `StatCell` draws the hairlines that make the strip one
              panel, and an anchor between the grid and the cell would break
              them.
            */}
            <Link
              href={slice.href}
              aria-label={`${slice.label} — see the entries`}
              className="absolute inset-0 rounded-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-link"
            />
          </div>
        ))}
      </StatStrip>

      {/*
        The sum, in one line rather than a paragraph.

        A total nobody can check is a total people go on checking by hand, so
        the arithmetic stays — but as figures, not prose. It is also the page's
        own test: if the four ever stop adding to the headline, it shows here.
      */}
      {data ? (
        <p className="col-amount text-xs text-muted-foreground">
          {money(data.salary)} + {money(data.tooling)} + {money(data.rent)} +{" "}
          {money(data.operational)} ={" "}
          <span className="font-medium text-foreground">
            {money(data.total)}
          </span>
        </p>
      ) : null}

      {/* Held, not spent — outside the four and outside the total. */}
      <Card>
        <CardBody>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Tax withheld
          </p>
          <p className="col-amount mt-1 text-lg font-semibold">
            {data ? money(data.withheld) : money("0")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Held against a tax liability, not spent.{" "}
            <Link
              href="/tax/withholding"
              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              The register
            </Link>{" "}
            has it person by person.
          </p>
        </CardBody>
      </Card>

    </>
  );
}
