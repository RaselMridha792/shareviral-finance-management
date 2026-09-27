import type { ComponentProps, ReactNode } from "react";

import { Glyph, type GlyphSource } from "@/components/ui/glyph";
import { cn } from "@/lib/utils";

/**
 * A white card, as the September 2026 handoff draws every one: 11px corners,
 * the line border and the soft three-step shadow.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("sv-card rounded-[11px] bg-(--sv-surface)", className)}
      {...props}
    />
  );
}

/**
 * The card's title row over a 1.5px rule: an optional 36px violet tile, the
 * title at 17px/800 and its line under it, and whatever belongs to the card at
 * the right-hand end.
 */
export function CardHeader({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** A Phosphor component, or a Material name (see `glyph.tsx`). */
  icon?: GlyphSource;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sv-panel-head flex items-center justify-between gap-4 px-5 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-[11px]">
        {icon ? (
          <span className="grid size-9 flex-none place-items-center rounded-[11px] bg-(--sv-violet-tint) text-(--sv-violet)">
            <Glyph icon={icon} size={20} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
            {title}
          </h2>
          {description ? (
            <p className="mt-px text-[12.5px] text-(--sv-muted)">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}
