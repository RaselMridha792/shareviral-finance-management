import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Every input, select and textarea, as the September 2026 handoff draws them:
 * 11px corners, a 1.5px line on the subtle ground, violet while typing.
 *
 * The colours of that border live in `.sv-control` (new-design.css): globals
 * sets `* { border-color }` outside any layer, which outranks a Tailwind
 * border colour, so a `focus:border-*` utility here would never paint.
 */
export const controlClass =
  "sv-control h-11 w-full rounded-[11px] border-[1.5px] bg-(--sv-subtle) px-3.5 text-[14.5px] outline-none disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string[];
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-extrabold">
        {label}
        {required ? (
          <span className="ml-0.5 text-(--sv-neg)" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {children}
      {error?.length ? (
        <span className="text-[12px] font-semibold text-(--sv-neg)">
          {error[0]}
        </span>
      ) : hint ? (
        <span className="text-[12px] text-(--sv-muted)">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(controlClass, "px-3 font-extrabold", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={3}
      className={cn(controlClass, "h-auto py-3 leading-relaxed", className)}
      {...props}
    />
  );
}

/** Money input: mono, right-aligned, and digits only. */
export function MoneyInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      inputMode="decimal"
      // Not type="number" — it lets browsers accept "1e5" and silently strips
      // leading zeros, and the spinner arrows are a hazard next to an amount.
      type="text"
      className={cn(controlClass, "col-amount pr-3.5", className)}
      {...props}
    />
  );
}

export function DateInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="date"
      className={cn(controlClass, "num", className)}
      {...props}
    />
  );
}
