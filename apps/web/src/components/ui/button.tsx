import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

/**
 * The September 2026 handoff's buttons, at the app's own heights.
 *
 * Bold (800), a lime primary with a soft lime shadow that lifts a pixel under
 * the pointer, a white secondary whose edge turns violet. The owner chose this
 * everywhere at once. The heights did NOT move — 36 and 32 — because every
 * filter row and form lines a button up against a 36px input, and a taller
 * button is a crooked row on every screen.
 *
 * The secondary's edge is the class `sv-button-quiet` (new-design.css) rather
 * than a border utility: globals.css's unlayered `* { border-color }` beats any
 * border-colour utility, so `hover:border-violet` would silently do nothing.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-transparent bg-primary text-primary-foreground shadow-[0_6px_16px_rgb(150_200_0/0.28)] enabled:hover:-translate-y-px enabled:hover:bg-(--sv-accent-hover)",
  secondary: "sv-button-quiet bg-surface text-foreground",
  ghost:
    "border border-transparent bg-transparent text-muted-foreground hover:bg-(--sv-violet-tint) hover:text-(--sv-violet-ink)",
  /**
   * For the button that ends something: deleting a document, voiding an entry.
   *
   * Solid rather than an outline, because it sits beside Cancel and the eye
   * should land on the one that cannot be undone before the hand does.
   */
  danger: "border border-transparent bg-negative text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-lg font-extrabold transition-[background-color,color,border-color,transform,opacity] duration-200",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
