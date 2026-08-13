"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { ChartTooltip } from "@/components/charts/chart-tooltip";
import { useMoney } from "@/components/settings-provider";

export function CategoryDonut({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  // The app's own formatter: taka, grouped the Bangladeshi way. This used to
  // call formatCurrency, whose default currency is USD — so the centre of the
  // donut read "$45,000" for ৳45,000.
  const money = useMoney();
  const total = data.reduce((sum, d) => sum + d.value, 0);

  // Container query, not viewport: this card is often a narrow grid column on a
  // wide screen, and side-by-side would clip the percent column.
  return (
    <div className="@container flex flex-col items-center gap-5 @md:flex-row">
      <div className="relative size-47.5 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={92}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted-foreground">Total spent</span>
          <span className="num text-lg font-semibold">
            {money(total, { hideDecimals: true })}
          </span>
        </div>
      </div>

      <ul className="flex w-full flex-col gap-2.5">
        {data.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2.5 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="truncate text-muted-foreground">{entry.name}</span>
            <span className="num ml-auto font-medium">
              {money(entry.value, { hideDecimals: true })}
            </span>
            <span className="num w-9 shrink-0 text-right text-xs text-muted-foreground">
              {((entry.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
