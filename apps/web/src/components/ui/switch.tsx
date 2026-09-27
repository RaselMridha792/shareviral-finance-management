"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * An on/off switch, as the September 2026 handoff draws every setting that is
 * a yes or a no: a 44×24 pill, violet when on and the grey track when off, a
 * white knob that slides.
 *
 * A `button` with `role="switch"` rather than a styled checkbox, because that
 * is what it is: pressing it changes the setting, and a screen reader says
 * "on" or "off" instead of "checked".
 */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
  labelledBy,
  describedBy,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** For a switch with no visible title beside it. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-(--sv-violet)" : "bg-(--sv-track)",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-[left] duration-300 ease-(--sv-ease)",
          checked ? "left-5" : "left-0.5",
        )}
      />
    </button>
  );
}

/**
 * A setting on its own row: the switch, the setting's name at 14.5px/800, the
 * line under it that says what on and off each mean, and — at the right — any
 * control the setting carries with it (the minimum tax's amount).
 *
 * The name is part of the target: pressing the words flips the switch too,
 * the way a checkbox's label does.
 */
export function SwitchRow({
  checked,
  onChange,
  disabled,
  title,
  description,
  children,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** A control that belongs to the setting, drawn at the row's right. */
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        // Wraps: where the row is too narrow for the words AND the control at
        // its right, the control drops under them rather than squeezing the
        // title to a word a line.
        "sv-switch-row flex flex-wrap items-start gap-x-3.5 gap-y-3 rounded-[11px] bg-(--sv-subtle) px-4 py-3.5",
        className,
      )}
    >
      <div className="flex min-w-[min(100%,15rem)] flex-1 items-start gap-3.5">
        <Switch
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          labelledBy={`${id}-title`}
          describedBy={description ? `${id}-description` : undefined}
        />
        <div className="min-w-0 flex-1">
          <p
            id={`${id}-title`}
            onClick={() => !disabled && onChange(!checked)}
            className={cn(
              "text-[14.5px] font-extrabold",
              !disabled && "cursor-pointer",
            )}
          >
            {title}
          </p>
          {description ? (
            <p
              id={`${id}-description`}
              className="mt-0.5 text-[12.5px] leading-normal text-(--sv-muted)"
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children ? <div className="flex-none">{children}</div> : null}
    </div>
  );
}
