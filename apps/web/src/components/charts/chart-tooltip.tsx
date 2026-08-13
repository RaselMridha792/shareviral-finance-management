"use client";

import { useMoney } from "@/components/settings-provider";

type Payload = {
  name?: string;
  dataKey?: string | number;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
};

/**
 * Shared Recharts tooltip. Recharts' own prop types are loose across versions,
 * so this takes the minimal shape it actually renders.
 *
 * Amounts go through the app's own formatter, which means taka with
 * Bangladeshi grouping. It used to call `formatCurrency`, whose default
 * currency is USD — so every tooltip in the app rendered ৳45,000 as "$45,000",
 * a figure a hundred and eighteen times wrong with nothing on screen to say so.
 */
export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
  labelKey,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Payload[];
  labelFormatter?: (label: string | number) => string;
  /** A field on the datum to title the tooltip with, instead of the axis tick. */
  labelKey?: string;
}) {
  const money = useMoney();
  if (!active || !payload?.length) return null;

  const fromDatum =
    labelKey && payload[0]?.payload
      ? (payload[0].payload[labelKey] as string | undefined)
      : undefined;
  const heading = fromDatum ?? label;

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-e2">
      {heading !== undefined ? (
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          {labelFormatter ? labelFormatter(heading) : heading}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        {payload.map((entry, i) => (
          <div
            key={`${entry.dataKey ?? entry.name}-${i}`}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="text-muted-foreground">
              {entry.name ?? entry.dataKey}
            </span>
            <span className="num ml-auto font-medium">
              {money(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
