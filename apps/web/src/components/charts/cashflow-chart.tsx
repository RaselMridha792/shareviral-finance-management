"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { formatCompactCurrency } from "@/lib/utils";

export function CashflowChart({
  data,
}: {
  data: { month: string; income: number; expenses: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickFormatter={(v: number) => formatCompactCurrency(v)}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-muted)" }}
          content={<ChartTooltip />}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground capitalize">
              {value}
            </span>
          )}
        />
        <Bar
          dataKey="income"
          name="Income"
          fill="var(--chart-1)"
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
        />
        <Bar
          dataKey="expenses"
          name="Expenses"
          fill="var(--chart-2)"
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
