"use client";

import { PLUS, formatCompactMoney, type WaterfallStep } from "@finance/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useSettings } from "@/components/settings-provider";

/**
 * Opening, every movement, closing — as a waterfall.
 *
 * The two pillars sit on zero and are read as positions; everything between
 * them floats, and a floating bar is read as a change. That is the whole point
 * of the shape: a column chart of the same numbers would put "salaries" and
 * "closing balance" side by side at the same height and invite the reader to
 * compare a flow against a stock.
 *
 * Built the standard way — a stacked bar whose first series is a transparent
 * pedestal and whose second is the visible delta. Recharts has no waterfall of
 * its own, and the pedestal is cheaper than a custom shape.
 */

const FILL: Record<WaterfallStep["kind"], string> = {
  // The two pillars share a colour because they are the same kind of thing:
  // a balance, not a movement.
  opening: "var(--chart-3)",
  closing: "var(--chart-3)",
  in: "var(--chart-1)",
  out: "var(--chart-5)",
};

type Datum = {
  label: string;
  short: string;
  kind: WaterfallStep["kind"];
  /** The transparent pedestal the visible bar floats on. */
  base: number;
  /** The visible bar: the magnitude of the movement, or the pillar's height. */
  span: number;
  delta: number | null;
  balance: number;
  /**
   * Deliberately not called `fill`. Recharts spreads every field of a datum
   * onto the rectangle it draws, so a field named `fill` paints the invisible
   * pedestal as well as the bar — which turned every falling step into a solid
   * column standing on zero.
   */
  colour: string;
};

/** Labels are ticks, not prose — a long category name would squash the chart. */
function shorten(label: string): string {
  return label.length > 13 ? `${label.slice(0, 12)}…` : label;
}

export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  const settings = useSettings();
  const format = settings.numberFormat;
  const compact = (value: number) =>
    formatCompactMoney(value, { currency: "BDT", format });

  const data: Datum[] = steps.map((step, i) => {
    const balance = Number(step.balance.bdt);
    const delta = step.delta ? Number(step.delta.bdt) : null;
    const pillar = step.kind === "opening" || step.kind === "closing";

    // Where this step started. Derived from its own delta rather than the
    // previous row's balance, so a gap in the series cannot silently bend the
    // staircase; only the opening pillar has neither.
    const previous = i > 0 ? Number(steps[i - 1].balance.bdt) : 0;
    const start = delta === null ? previous : balance - delta;

    // A step that crosses zero cannot be drawn as a pedestal plus a span —
    // stacking would split it across the two sides of the axis. It is drawn
    // from zero instead, which is the honest reading of a balance that went
    // from positive to negative.
    const crossesZero = !pillar && Math.sign(start) * Math.sign(balance) < 0;

    return {
      label: step.label,
      short: shorten(step.label),
      kind: step.kind,
      base: pillar || crossesZero ? 0 : Math.min(start, balance),
      span:
        pillar || crossesZero
          ? balance
          : Math.max(start, balance) - Math.min(start, balance),
      delta,
      balance,
      colour: FILL[step.kind],
    };
  });

  /**
   * Each bar carries two lines: what moved, and where that left the balance.
   * Recharts hands a custom label the bar's own rectangle rather than the
   * position it computed, so the centring is done here.
   */
  const renderLabel = (props: {
    x?: string | number;
    y?: string | number;
    width?: string | number;
    index?: number;
  }) => {
    const datum = data[props.index ?? 0];
    if (!datum) return <g />;

    const centre = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
    const top = Number(props.y ?? 0);
    const pillar = datum.kind === "opening" || datum.kind === "closing";
    const headline =
      datum.delta === null
        ? compact(datum.balance)
        : `${datum.delta > 0 ? PLUS : ""}${compact(datum.delta)}`;

    return (
      <g>
        <text
          x={centre}
          y={top - (pillar ? 8 : 20)}
          textAnchor="middle"
          className="num"
          fontSize={11}
          fontWeight={600}
          fill="var(--foreground)"
        >
          {headline}
        </text>
        {pillar ? null : (
          <text
            x={centre}
            y={top - 8}
            textAnchor="middle"
            className="num"
            fontSize={10}
            fill="var(--muted-foreground)"
          >
            {compact(datum.balance)}
          </text>
        )}
      </g>
    );
  };

  // Below about 90px a bar cannot hold its own label, so the chart keeps its
  // width and scrolls inside its container rather than shrinking to fit.
  const minWidth = Math.max(560, data.length * 92);

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={data}
            margin={{ top: 34, right: 8, left: -6, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="short"
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={62}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              // Lakh and crore, not k and M.
              tickFormatter={(value: number) => compact(value)}
            />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={<WaterfallTooltip />}
            />

            {/* The pedestal. Invisible, and never in the tooltip — it is a
                drawing device, not a figure anybody should read. */}
            <Bar
              dataKey="base"
              stackId="waterfall"
              fill="transparent"
              // Belt and braces: whatever fill this bar ends up resolving,
              // zero opacity keeps the pedestal invisible.
              fillOpacity={0}
              stroke="none"
              maxBarSize={44}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
            {/* No entrance animation: this page is printed and screenshotted,
                and a chart caught mid-grow reads as a wrong figure. */}
            <Bar
              dataKey="span"
              stackId="waterfall"
              radius={[3, 3, 0, 0]}
              maxBarSize={44}
              // A movement worth a hundredth of the balance rounds to nothing
              // at this scale, and Recharts drops a zero-height rectangle
              // along with its label — so the step would leave the chart
              // without leaving the data. Two pixels keeps it on the page; the
              // figure above the bar is what is actually read.
              minPointSize={2}
              isAnimationActive={false}
            >
              {data.map((datum) => (
                <Cell key={datum.label} fill={datum.colour} />
              ))}
              <LabelList dataKey="span" content={renderLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * The shared tooltip, given the two figures a waterfall step actually has.
 *
 * Recharts would otherwise offer the stacked geometry — a pedestal and a
 * magnitude — neither of which is the number on the page.
 */
function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Datum }>;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;

  const rows = [
    ...(datum.delta === null
      ? []
      : [
          {
            name: datum.kind === "in" ? "Received" : "Paid out",
            dataKey: "delta",
            value: datum.delta,
            color: datum.colour,
          },
        ]),
    {
      name: datum.kind === "opening" ? "Opened at" : "Balance after",
      dataKey: "balance",
      value: datum.balance,
      color: "var(--chart-3)",
    },
  ];

  return <ChartTooltip active label={datum.label} payload={rows} />;
}
