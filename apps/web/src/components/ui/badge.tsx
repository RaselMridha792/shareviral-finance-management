import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative" | "warning" | "primary";

/** The handoff's pills: a tint behind its own colour, 12px/800. */
const TONES: Record<Tone, string> = {
  neutral: "bg-(--sv-subtle) text-(--sv-muted)",
  positive: "bg-(--sv-pos-tint) text-(--sv-pos)",
  negative: "bg-(--sv-neg-tint) text-(--sv-neg)",
  warning: "bg-(--sv-warn-tint) text-(--sv-warn)",
  primary: "bg-(--sv-violet-tint) text-(--sv-violet-ink)",
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
        "inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[12px] leading-[1.35] font-extrabold whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
