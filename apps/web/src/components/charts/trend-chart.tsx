"use client";

import type { MonthStat } from "@finance/shared";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompactMoney } from "@finance/shared";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useSettings } from "@/components/settings-provider";

/**
 * A year of money, in one picture.
 *
 * Bars for what came in and went out, because those are discrete monthly
 * events and a bar is a quantity. A line for the closing balance, because that
 * is a position carried from month to month and a line is the only shape that
 * reads as continuous. Mixing them is the point: a month can take more than it
 * gave and the balance still climb, and that is exactly the thing a single
 * series would hide.
 */
export function TrendChart({
  months,
  currency,
}: {
  months: MonthStat[];
  currency: string;
}) {
  const settings = useSettings();
  const data = months.map((month) => ({
    // "August 2026" is too wide for twelve ticks; the year still shows in the
    // tooltip, where it is actually read.
    month: month.label.replace(/\s\d{4}$/, "").slice(0, 3),
    full: month.label,
    In: Number(month.moneyIn),
    Out: Number(month.moneyOut),
    Balance: Number(month.closingBalance),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
      >
        <defs>
          <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={62}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          // Lakh and crore, not k and M — see formatCompactMoney.
          tickFormatter={(v: number) =>
            formatCompactMoney(v, {
              currency,
              format: settings.numberFormat,
            })
          }
        />
        <Tooltip
          cursor={{ fill: "var(--surface-muted)" }}
          content={<ChartTooltip labelKey="full" />}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />

        {/* No entrance animation. A dashboard is glanced at, printed and
            screenshotted; a chart that is still growing when the eye arrives
            reads as an empty chart. It is also the honest reading of
            prefers-reduced-motion, which this cannot check per-user. */}
        <Bar
          dataKey="In"
          fill="var(--chart-1)"
          radius={[3, 3, 0, 0]}
          maxBarSize={18}
          isAnimationActive={false}
        />
        <Bar
          dataKey="Out"
          fill="var(--chart-5)"
          radius={[3, 3, 0, 0]}
          maxBarSize={18}
          isAnimationActive={false}
        />
        <Area
          dataKey="Balance"
          stroke="none"
          fill="url(#balance-fill)"
          legendType="none"
          tooltipType="none"
          isAnimationActive={false}
        />
        <Line
          dataKey="Balance"
          stroke="var(--chart-3)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
