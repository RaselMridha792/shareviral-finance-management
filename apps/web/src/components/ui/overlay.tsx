"use client";

import { Download, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { useScrollLock } from "@/components/ui/scroll-lock";
import { cn } from "@/lib/utils";

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
 *
 * **The bytes are fetched here rather than framed from `src` directly, and
 * that is the whole reason this works.** The app is served from one host and
 * the API from another, and the API sends `X-Frame-Options: SAMEORIGIN` and
 * `frame-ancestors 'self'`, so a frame pointed straight at it is refused:
 * "api.hellonizam.com refused to connect", measured and reproduced locally as
 * *Framing 'localhost:4001' violates … "frame-ancestors 'self'"*. Every
 * uploaded document on a team member's profile was unviewable because of it.
 *
 * Fetching the file and framing a `blob:` URL sidesteps it, because the
 * frame's origin is then this page's own. It is also better than relaxing the
 * header: the API goes on refusing to be framed by anybody, which is what that
 * header is for, and the page reads the file through the session it already
 * holds.
 *
 * `ledger/documents-dialog.tsx` has its own copy of this technique, written
 * when the ledger hit the same wall. Two copies of one lesson is how the
 * second one gets forgotten — worth folding together when somebody is next in
 * both files.
 */
export function DocumentViewer({
  open,
  src,
  name,
  downloadHref,
  onClose,
}: {
  open: boolean;
  /** Where the bytes live — an API URL, fetched here, never framed directly. */
  src: string | null;
  name: string;
  downloadHref: string;
  onClose: () => void;
}) {
  useDismissable(open, onClose);

  /*
   * The fetching lives in a child that only exists while the viewer is open,
   * and that is the whole fix rather than a tidy-up.
   *
   * It used to keep `failedSrc` in this component and never clear it. So one
   * failed fetch — a dropped connection, a token that expired between loading
   * the page and clicking, an API restart — marked that document unopenable
   * for the rest of the session: closing and clicking again showed the same
   * "could not be opened" without retrying, and only a page reload cured it.
   * That is the "majhe majhe view korle error dekhay" the owner has reported
   * more than once. Not sometimes-broken files — permanently broken state
   * after one bad moment.
   *
   * It also revoked the object URL in the effect cleanup while state still
   * named it, so reopening framed a dead blob for a beat, which the browser
   * console reported as `requestfailed blob:…`.
   *
   * Unmounting on close fixes both at once and needs no clearing logic to get
   * right: there is no state left to be stale, so opening again is a genuine
   * second attempt.
   */
  if (!open || !src) return null;

  return (
    <ViewerShell
      key={src}
      src={src}
      name={name}
      downloadHref={downloadHref}
      onClose={onClose}
    />
  );
}

function ViewerShell({
  src,
  name,
  downloadHref,
  onClose,
}: {
  src: string;
  name: string;
  downloadHref: string;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState<{ url: string | null } | null>(null);
  /*
   * Mirrors the url so unmount can release it. State cannot be read from a
   * cleanup that runs after the component is gone, and the frame is still
   * reading the blob right up until then.
   */
  const held = useRef<string | null>(null);

  useEffect(() => {
    let live = true;

    fetch(src, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => {
        if (!live) return;
        const url = URL.createObjectURL(blob);
        held.current = url;
        setAttempt({ url });
      })
      .catch(() => {
        if (live) setAttempt({ url: null });
      });

    return () => {
      live = false;
    };
  }, [src]);

  useEffect(
    () => () => {
      if (held.current) URL.revokeObjectURL(held.current);
      held.current = null;
    },
    [],
  );

  const framed = attempt?.url ?? null;
  const failed = attempt !== null && attempt.url === null;

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
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-surface"
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

        {failed ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              This document could not be opened here.
            </p>
            <a
              href={downloadHref}
              className="text-sm text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              Download it instead
            </a>
          </div>
        ) : framed ? (
          <iframe
            src={framed}
            title={name}
            className="min-h-0 flex-1 bg-white"
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Opening…</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** A stored image over the page, fitted to it and zoomable (`ZoomableImage`). */
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

      <ZoomableImage src={src} alt={alt} maxVh={92} />
    </div>
  );
}

/** How far a picture can be blown up, as multiples of its fitted size. */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * A picture that can be looked at closely (the owner, 29 Oct 2026: "file type
 * image hole oikhane ekta zoom button rakhte hobe jate zoom kore dekha jay").
 *
 * It opens fitted — never larger than the room it has, and never blown up past
 * its own pixels — and the buttons in its corner enlarge it in steps. Zoomed,
 * it grows inside a frame that keeps the fitted size, so the dialog around it
 * does not jump; it is moved about by dragging or scrolling. A double-click
 * goes to 2× and back.
 *
 * Shared by the full-screen lightbox and the documents dialog, so a receipt
 * zooms the same way wherever it is opened.
 */
export function ZoomableImage({
  src,
  alt,
  maxVh,
}: {
  src: string;
  alt: string;
  /** The tallest it may be when fitted, in viewport heights. */
  maxVh: number;
}) {
  const room = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [space, setSpace] = useState<{ w: number; h: number } | null>(null);
  const [step, setStep] = useState(0);
  /* Where the middle of the view was, carried across a zoom so the spot being
     looked at stays in the middle rather than sliding off to the corner. */
  const centre = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    const el = room.current;
    if (!el) return;
    const measure = () =>
      setSpace({ w: el.clientWidth, h: (window.innerHeight * maxVh) / 100 });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [maxVh]);

  useLayoutEffect(() => {
    const el = frame.current;
    const at = centre.current;
    if (!el || !at) return;
    el.scrollLeft = at.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = at.y * el.scrollHeight - el.clientHeight / 2;
    centre.current = null;
  }, [step]);

  const fit =
    natural && space
      ? Math.min(space.w / natural.w, space.h / natural.h, 1)
      : null;
  const zoom = ZOOM_STEPS[step];
  const fitted =
    natural && fit ? { w: natural.w * fit, h: natural.h * fit } : null;

  function zoomTo(next: number) {
    const el = frame.current;
    if (el) {
      centre.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setStep(Math.min(Math.max(next, 0), ZOOM_STEPS.length - 1));
  }

  function grab(event: PointerEvent<HTMLDivElement>) {
    const el = frame.current;
    if (!el || step === 0) return;
    el.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
  }

  function pull(event: PointerEvent<HTMLDivElement>) {
    const el = frame.current;
    const from = drag.current;
    if (!el || !from) return;
    el.scrollLeft = from.left - (event.clientX - from.x);
    el.scrollTop = from.top - (event.clientY - from.y);
  }

  const control =
    "cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:cursor-default disabled:opacity-40";

  return (
    <div ref={room} className="w-full">
      <div
        className="relative mx-auto max-w-full"
        style={fitted ? { width: fitted.w } : undefined}
      >
        <div
          ref={frame}
          data-zoom-frame
          className={cn(
            "overflow-auto rounded-lg",
            step > 0 && "cursor-grab active:cursor-grabbing",
          )}
          style={fitted ? { height: fitted.h } : undefined}
          onPointerDown={grab}
          onPointerMove={pull}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {/*
            Not next/image: these bytes sit behind a permission check on
            another origin, and the optimiser would fetch them itself, without
            the browser's session.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(event) =>
              setNatural({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={() => zoomTo(step === 0 ? 2 : 0)}
            className="mx-auto block max-w-none select-none"
            style={
              fitted
                ? { width: fitted.w * zoom, height: fitted.h * zoom }
                : { maxWidth: "100%", maxHeight: `${maxVh}vh` }
            }
          />
        </div>

        {fitted ? (
          <div
            role="group"
            aria-label="Zoom"
            onClick={(event) => event.stopPropagation()}
            className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full border border-border bg-surface/95 px-1 py-0.5 shadow-lg backdrop-blur"
          >
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={step === 0}
              onClick={() => zoomTo(step - 1)}
              className={control}
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Fit to the window"
              title="Fit to the window"
              disabled={step === 0}
              onClick={() => zoomTo(0)}
              className="num min-w-12 cursor-pointer rounded-full px-1 text-center text-xs text-muted-foreground transition hover:text-foreground disabled:cursor-default"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={step === ZOOM_STEPS.length - 1}
              onClick={() => zoomTo(step + 1)}
              className={control}
            >
              <ZoomIn className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
