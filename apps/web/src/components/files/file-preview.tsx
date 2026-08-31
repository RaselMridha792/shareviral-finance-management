"use client";

import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { useState } from "react";

import { DocumentViewer, ImageLightbox } from "@/components/ui/overlay";

/**
 * Look at a file before it is saved — and at the ones already saved.
 *
 * The owner's asks, in the order they arrived:
 *
 *   - "jokhon kono kichu upload korbo seta jate preview kora jay click korlei
 *     okhanei save dewar agei" — the file just chosen has to be openable
 *     BEFORE the form is submitted;
 *   - a drawer opened to edit has to show what is ALREADY on file;
 *   - "multiple documents hole slider or different type er method use korba" —
 *     several papers on one entry are moved between rather than listed.
 *
 * So this takes one item or several, and does not make the caller care which.
 * With one there is no slider; with several there is a counter and a pair of
 * arrows, and the arrow keys work because somebody flicking through six
 * screenshots will reach for them.
 *
 * NO EFFECTS. Object URLs are minted in the click that asks for them and
 * released in the click that closes it — both event handlers, both
 * synchronous, and neither able to leave a URL behind on a re-render. Doing it
 * in an effect is what the cascading-render lint rule warns against, and it is
 * also how the document viewer came to frame a blob it had already revoked.
 */

export type Stored = {
  name: string;
  /** Where the bytes live, behind the app's own permission check. */
  href: string;
  isImage: boolean;
};

const isFile = (item: File | Stored): item is File =>
  typeof File !== "undefined" && item instanceof File;

const asStored = (
  item: File | Stored,
): { view: Stored; objectUrl: string | null } => {
  if (!isFile(item)) return { view: item, objectUrl: null };
  const objectUrl = URL.createObjectURL(item);
  return {
    view: {
      name: item.name,
      href: objectUrl,
      isImage: item.type.startsWith("image/"),
    },
    objectUrl,
  };
};

/** Images open at their own size; everything else is framed as a document. */
function OnePreview({
  view,
  local,
  onClose,
  chrome,
}: {
  view: Stored;
  /** True when `href` is an object URL rather than an address on the API. */
  local: boolean;
  onClose: () => void;
  /** The slider, when there is more than one. Rendered over the viewer. */
  chrome?: React.ReactNode;
}) {
  return (
    <>
      {view.isImage ? (
        <ImageLightbox open src={view.href} alt={view.name} onClose={onClose} />
      ) : (
        <DocumentViewer
          open
          /*
           * `?inline=1` asks the API to serve it for viewing rather than as a
           * download. An object URL has no such query to add, and adding one
           * would make the blob unfindable.
           */
          src={local ? view.href : `${view.href}?inline=1`}
          name={view.name}
          downloadHref={view.href}
          onClose={onClose}
        />
      )}
      {chrome}
    </>
  );
}

/**
 * The eye that opens it.
 *
 * Its own component so every picker in the app offers the same target in the
 * same place, and so the aria-label is predictable enough to be tested by.
 */
export function PreviewButton({
  name,
  count,
  onClick,
}: {
  name: string;
  /** Shown when several papers sit behind one eye. */
  count?: number;
  onClick: () => void;
}) {
  const label =
    count && count > 1 ? `Preview ${count} documents` : `Preview ${name}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition hover:text-foreground"
    >
      <Eye className="size-3.5" />
      {count && count > 1 ? (
        <span className="absolute -top-0.5 -right-0.5 rounded-full bg-primary px-1 text-[9px] leading-[14px] font-medium text-primary-foreground">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * What one picker needs, in one call.
 *
 * `show` takes a single item or a list. Adding preview to a form is then three
 * lines — the hook, a `<PreviewButton>`, and `{preview.overlay}` before the
 * closing tag — rather than a copy-pasted block of dialog wiring that each
 * screen gets subtly wrong.
 */
export function useFilePreview() {
  const [shown, setShown] = useState<{
    items: { view: Stored; objectUrl: string | null }[];
    at: number;
  } | null>(null);

  const release = (previous: typeof shown) => {
    for (const item of previous?.items ?? []) {
      if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    }
  };

  const show = (item: File | Stored | (File | Stored)[], startAt = 0) => {
    const list = Array.isArray(item) ? item : [item];
    setShown((previous) => {
      release(previous);
      if (list.length === 0) return null;
      return {
        items: list.map(asStored),
        at: Math.min(Math.max(startAt, 0), list.length - 1),
      };
    });
  };

  const hide = () =>
    setShown((previous) => {
      release(previous);
      return null;
    });

  const step = (by: number) =>
    setShown((previous) =>
      previous
        ? {
            ...previous,
            // Wraps, because six screenshots in a ring is what a slider is.
            at:
              (previous.at + by + previous.items.length) %
              previous.items.length,
          }
        : previous,
    );

  const current = shown?.items[shown.at] ?? null;
  const many = (shown?.items.length ?? 0) > 1;

  return {
    showing: current?.view ?? null,
    count: shown?.items.length ?? 0,
    show,
    hide,
    /** Render this once, anywhere inside the form. */
    overlay: current ? (
      <OnePreview
        // Keyed so the viewer refetches when the slider moves: without it the
        // frame keeps the blob of the document that was on screen a moment ago.
        key={current.view.href}
        view={current.view}
        local={Boolean(current.objectUrl)}
        onClose={hide}
        chrome={
          many && shown ? (
            <div
              className="pointer-events-none fixed inset-x-0 bottom-6 z-[96] flex justify-center"
              role="group"
              aria-label="Move between the documents"
            >
              <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/95 px-2 py-1 shadow-lg backdrop-blur">
                <button
                  type="button"
                  aria-label="Previous document"
                  onClick={() => step(-1)}
                  className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="num min-w-14 text-center text-xs text-muted-foreground">
                  {shown.at + 1} of {shown.items.length}
                </span>
                <button
                  type="button"
                  aria-label="Next document"
                  onClick={() => step(1)}
                  className="cursor-pointer rounded-full p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          ) : null
        }
      />
    ) : null,
  };
}
