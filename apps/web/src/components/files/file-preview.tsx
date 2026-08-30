"use client";

import { Eye } from "lucide-react";
import { useState } from "react";

import { DocumentViewer, ImageLightbox } from "@/components/ui/overlay";

/**
 * Look at a file before it is saved — and at the one already saved.
 *
 * The owner's complaint was two-sided, and a picker that answers one half and
 * not the other still feels broken:
 *
 *   - "jokhon kono kichu upload korbo seta jate preview kora jay click korlei
 *     okhanei save dewar agei" — the file just chosen has to be openable
 *     BEFORE the form is submitted. Every picker in this app showed a file
 *     name and nothing else, so the only way to find out whether the right
 *     scan had been attached was to save and then go and look.
 *   - a drawer opened to edit somebody has to show what is ALREADY on file.
 *     "Photo — Choose a file" against a person whose photograph is on the
 *     screen behind the drawer reads as the app having lost it.
 *
 * So this takes either kind and does not make the caller care which: a `File`
 * the browser holds and nothing has uploaded yet, or a `Stored` one that lives
 * behind the API.
 *
 * NO EFFECTS. An object URL is minted in the click that asks for it and
 * released in the click that closes it — both event handlers, both synchronous,
 * and neither able to leave a URL behind on a re-render. Doing it in an effect
 * is what the lint rule about cascading renders is warning against, and it is
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

/** Images open at their own size; everything else is framed as a document. */
export function FilePreview({
  view,
  local,
  onClose,
}: {
  view: Stored | null;
  /** True when `href` is an object URL rather than an address on the API. */
  local: boolean;
  onClose: () => void;
}) {
  if (!view) return null;

  if (view.isImage) {
    return <ImageLightbox open src={view.href} alt={view.name} onClose={onClose} />;
  }

  return (
    <DocumentViewer
      open
      /*
       * `?inline=1` asks the API to serve it for viewing rather than as a
       * download. An object URL has no such query to add, and adding one would
       * make the blob unfindable.
       */
      src={local ? view.href : `${view.href}?inline=1`}
      name={view.name}
      downloadHref={view.href}
      onClose={onClose}
    />
  );
}

/**
 * The eye that opens it.
 *
 * Its own component so every picker in the app offers the same target in the
 * same place, rather than each inventing one — and so the aria-label is
 * predictable enough to be tested by.
 */
export function PreviewButton({
  name,
  onClick,
}: {
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Preview ${name}`}
      title={`Preview ${name}`}
      className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition hover:text-foreground"
    >
      <Eye className="size-3.5" />
    </button>
  );
}

/**
 * What one picker needs, in one call.
 *
 * Adding preview to a form is then three lines — `const preview =
 * useFilePreview()`, a `<PreviewButton onClick={() => preview.show(file)} />`,
 * and `{preview.overlay}` before the closing tag — rather than a copy-pasted
 * block of dialog wiring that each screen gets subtly wrong.
 */
export function useFilePreview() {
  const [shown, setShown] = useState<{
    view: Stored;
    /** Held so it can be revoked; null for anything already on the server. */
    objectUrl: string | null;
  } | null>(null);

  const release = (previous: { objectUrl: string | null } | null) => {
    if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
  };

  const show = (item: File | Stored) => {
    setShown((previous) => {
      release(previous);
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
    });
  };

  const hide = () =>
    setShown((previous) => {
      release(previous);
      return null;
    });

  return {
    showing: shown?.view ?? null,
    show,
    hide,
    /** Render this once, anywhere inside the form. */
    overlay: (
      <FilePreview
        view={shown?.view ?? null}
        local={Boolean(shown?.objectUrl)}
        onClose={hide}
      />
    ),
  };
}
