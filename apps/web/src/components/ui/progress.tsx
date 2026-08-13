import { cn } from "@/lib/utils";

export function Progress({
  value,
  color = "var(--primary)",
  className,
  overflowColor = "var(--negative)",
}: {
  /** 0–100. Values above 100 clamp the bar and switch it to the overflow color. */
  value: number;
  color?: string;
  overflowColor?: string;
  className?: string;
}) {
  const over = value > 100;
  const width = Math.min(Math.max(value, 0), 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-muted",
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${width}%`, background: over ? overflowColor : color }}
      />
    </div>
  );
}
