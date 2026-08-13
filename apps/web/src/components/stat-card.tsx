import { TrendingDown, TrendingUp } from "lucide-react";
import type { ComponentType } from "react";

import { Card } from "@/components/ui/card";
import { cn, formatPercent } from "@/lib/utils";

export function StatCard({
  label,
  value,
  delta,
  /** When true, a rising number is bad (e.g. expenses) and colors invert. */
  invertDelta = false,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: number;
  invertDelta?: boolean;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  const isUp = (delta ?? 0) >= 0;
  const isGood = invertDelta ? !isUp : isUp;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-surface-muted text-muted-foreground">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>

      <p className="num mt-3 text-2xl font-semibold tracking-tight">{value}</p>

      <div className="mt-2 flex items-center gap-2 text-xs">
        {delta !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              isGood ? "text-positive" : "text-negative",
            )}
          >
            <TrendIcon className="size-3.5" />
            {formatPercent(delta)}
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
    </Card>
  );
}
