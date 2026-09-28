"use client";

import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { useScrollLock } from "@/components/ui/scroll-lock";
import { cn } from "@/lib/utils";

/**
 * A popup for the invoice screens: the row's invoice, and "Invoice saved".
 *
 * The app's `Drawer` drawn wider. An invoice is an A4 page, and the Drawer's
 * 560px would shrink it to two-thirds before a word of it could be read; a
 * width is not something the Drawer takes, and giving it one is a change to
 * the popup every other screen opens. So the same parts — the backdrop, the
 * panel, the header with its close button, the footer on the subtle ground,
 * Escape closing only the popup on top — at the width an invoice needs.
 */
export function InvoiceModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "wide",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** "wide" holds an invoice; "narrow" is a message. */
  size?: "wide" | "narrow";
}) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const client = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const popups = document.querySelectorAll("[data-popup]");
      if (popups[popups.length - 1] === root.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !client) return null;

  return createPortal(
    <div
      ref={root}
      data-popup=""
      className="fixed inset-0 z-50 flex items-center justify-center p-3 text-left whitespace-normal sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-invoice-modal={size}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="sv-popup-backdrop absolute inset-0 cursor-default"
      />
      <div
        className={cn(
          "sv-popup-panel relative flex max-h-full w-full flex-col overflow-hidden rounded-[14px] bg-(--sv-surface) text-(--sv-ink)",
          size === "wide" ? "max-w-[920px]" : "max-w-[460px]",
        )}
      >
        <header className="flex flex-none items-start gap-4 border-b px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-[18px] leading-snug font-extrabold tracking-[-0.01em]"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13.5px] text-(--sv-muted)">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 grid size-9 flex-none cursor-pointer place-items-center rounded-lg text-(--sv-muted) transition-colors hover:bg-(--sv-violet-tint) hover:text-(--sv-violet-ink)"
          >
            <XIcon weight="bold" size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {footer ? (
          <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t bg-(--sv-subtle) px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function noSubscription() {
  return () => {};
}
