import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative" | "warning" | "primary";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted-foreground",
  positive: "bg-positive/12 text-positive",
  negative: "bg-negative/12 text-negative",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/12 text-primary",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
