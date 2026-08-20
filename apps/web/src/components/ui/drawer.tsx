"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useScrollLock } from "@/components/ui/scroll-lock";

/**
 * Slide-over panel for create and edit forms.
 *
 * A panel rather than a modal so the list stays visible behind it — useful
 * when the thing being typed is being compared against the rows on screen.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Separate from the key handler below, which has to follow `onClose` and so
  // re-runs whenever the caller passes a fresh one. The lock must not.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-e2">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-surface-muted"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
