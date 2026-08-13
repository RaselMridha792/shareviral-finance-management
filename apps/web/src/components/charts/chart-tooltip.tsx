"use client";

import { formatCurrency } from "@/lib/utils";

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
 */
export function ChartTooltip({
  active,
  label,
  payload,
  labelFormatter,
}: {
  active?: boolean;
  label?: string | number;
  payload?: Payload[];
  labelFormatter?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-e2">
      {label !== undefined ? (
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          {labelFormatter ? labelFormatter(label) : label}
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
            <span className="text-muted-foreground capitalize">
              {entry.name ?? entry.dataKey}
            </span>
            <span className="num ml-auto font-medium">
              {formatCurrency(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
