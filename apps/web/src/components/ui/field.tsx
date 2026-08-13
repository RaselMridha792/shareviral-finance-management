import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export const controlClass =
  "h-10 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm outline-none transition " +
  "focus-visible:border-primary focus-visible:bg-surface disabled:opacity-50 " +
  "aria-[invalid=true]:border-negative";

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
      <span className="text-sm font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-negative" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
      {children}
      {error?.length ? (
        <span className="text-xs text-negative">{error[0]}</span>
      ) : hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={3}
      className={cn(controlClass, "h-auto py-2 leading-relaxed", className)}
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
      className={cn(controlClass, "col-amount pr-3", className)}
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
