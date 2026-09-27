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

/**
 * The popup every create and edit form opens in.
 *
 * It was a slide-over panel at the right-hand edge, on the reasoning that the
 * list stays visible behind it. The owner asked for a popup instead — "sidebar
 * drawer na hoye popup window hobe sundor" — for every one of them, and was
 * shown all twenty-six first. So it is centred now, in the September design:
 * a white card with 14px corners over a blurred backdrop, the title fixed at
 * the top and the form scrolling beneath it. A caller that passes `footer`
 * gets its buttons fixed at the bottom too; the forms that put their Save at
 * the end of the form still scroll to it, as they did in the panel.
 *
 * The name stays `Drawer` and the props stay what they were, deliberately:
 * twenty files open one, and a rename would be twenty edits that change
 * nothing a person can see.
 *
 * RENDERED AT THE END OF <body>, THROUGH A PORTAL, and three old faults go
 * with that:
 *
 *   - A form opened from a table row was drawn INSIDE the cell, and inherited
 *     it — `white-space: nowrap` (the tax working once came out 833px wide in
 *     a 447px panel), a money column's right-alignment, a coloured row's green
 *     or red ink.
 *   - The category popup opened from inside the transaction form was a <form>
 *     inside a <form>, which React reports on every open and HTML forbids.
 *   - A second popup opened from inside a first could be caught by anything
 *     the first did to its own box.
 *
 * What a portal does NOT change is React's own event bubbling, which follows
 * the component tree. So a submit inside a popup still travelled up to a form
 * the popup was opened from: adding a category from the transaction form ran
 * the TRANSACTION form's submit as well — a half-typed entry sent to the
 * server, or a whole one saved while somebody only meant to add a heading.
 * Submits stop at the popup's edge now. No caller relies on one getting out:
 * none renders a Drawer inside its own <form>, and every drawer without a form
 * saves from its own state.
 *
 * Escape closes the top popup only. Both listened to the document, so one
 * press used to close the category popup and the form under it together.
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
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  // A portal needs `document`, which the server does not have. Nothing opens
  // on the server anyway; this only keeps the first client render in step.
  const client = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  // Separate from the key handler below, which has to follow `onClose` and so
  // re-runs whenever the caller passes a fresh one. The lock must not.
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only the popup on top: the last one in the document, since each is
      // appended to <body> as it opens.
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
      // A submit inside the popup ends here — see the note above.
      onSubmit={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Close"
        // The X in the corner is the keyboard's way out; this is the pointer's.
        tabIndex={-1}
        onClick={onClose}
        className="sv-popup-backdrop absolute inset-0 cursor-default"
      />
      <div className="sv-popup-panel relative flex max-h-full w-full max-w-140 flex-col overflow-hidden rounded-[14px] bg-(--sv-surface) text-(--sv-ink)">
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
