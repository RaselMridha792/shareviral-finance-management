"use client";

import { Download, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useScrollLock } from "@/components/ui/scroll-lock";

/**
 * Escape closes it, and the page behind stops scrolling while it is open.
 *
 * Shared by both overlays below rather than written twice, because the second
 * copy is the one that forgets to put the scrollbar back.
 *
 * The scrolling half is counted rather than saved and restored — a confirm
 * dialog is routinely raised from inside a drawer that is already holding the
 * page still, and two of these each putting back what they found is what left
 * the page unscrollable. See `useScrollLock`.
 */
export function useDismissable(open: boolean, onClose: () => void) {
  useScrollLock(open);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/**
 * Asking before something cannot be undone.
 *
 * Replaces `window.confirm`, which is a different typeface, a different
 * position on every operating system, and — the part that matters — worded by
 * the browser rather than by the app. "Are you sure?" with an OK button says
 * nothing about what is about to happen; this says what will go and what that
 * costs.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useDismissable(open, onCancel);
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        // Clicks inside must not reach the backdrop's dismiss.
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted-foreground">{body}</div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "danger" : "primary"}
            disabled={pending}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A stored document, read without leaving the page.
 *
 * Clicking a PDF used to put it in the Downloads folder, which is the wrong
 * default for the common act: somebody checking whether the appointment letter
 * on file is the signed one does not want a copy of it, they want to look at
 * it. Saving is still a click away, in the corner.
 *
 * The `?inline=1` is what makes the API send it to be displayed rather than
 * saved. A PDF shown this way runs in the browser's own viewer, which is
 * sandboxed away from the page around it.
 */
export function DocumentViewer({
  open,
  src,
  name,
  downloadHref,
  onClose,
}: {
  open: boolean;
  src: string | null;
  name: string;
  downloadHref: string;
  onClose: () => void;
}) {
  useDismissable(open, onClose);
  if (!open || !src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[95] flex flex-col bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{name}</p>
          <a
            href={downloadHref}
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
            aria-label={`Download ${name}`}
          >
            <Download className="size-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <iframe src={src} title={name} className="min-h-0 flex-1 bg-white" />
      </div>
    </div>
  );
}

/** A stored image at its own size, over the page. */
export function ImageLightbox({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean;
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  useDismissable(open, onClose);
  if (!open || !src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
      >
        <X className="size-5" />
      </button>

      {/*
        Not next/image: these bytes sit behind a permission check on another
        origin, and the optimiser would fetch them itself, without the
        browser's session.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
