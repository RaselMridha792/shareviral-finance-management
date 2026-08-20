"use client";

import { Download, FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  fileHref,
  listTransactionFiles,
  type StoredFile,
} from "@/lib/api-client";
import { listSubscriptionFiles } from "@/lib/subscriptions";

/**
 * A PDF, drawn from bytes this page fetched itself.
 *
 * Pointing an iframe straight at the API does not work and the reason is not
 * the code: the app is served from one host and the API from another, and the
 * API sends `X-Frame-Options`, so the browser refuses to frame it and shows
 * "refused to connect". Images are unaffected — that header governs frames,
 * not `<img>`.
 *
 * Fetching the bytes and framing a `blob:` URL sidesteps it entirely, because
 * the frame's origin is then this page's own. It is also the better answer than
 * relaxing the header: the API keeps refusing to be framed by anybody, which is
 * what that header is for, and this page gets the file through the session it
 * already holds.
 *
 * `?inline=1` still matters — without it the same bytes carry an attachment
 * disposition and the viewer offers to save rather than draw.
 */
function PdfFrame({ file }: { file: StoredFile }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let live = true;

    fetch(`${fileHref(file.id)}?inline=1`, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (live) setSrc(url);
        // Revoked on unmount rather than here: the frame is still reading it.
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id]);

  if (failed) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
        <FileText className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          This one would not open here. Download it to read it.
        </span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-[55vh] items-center justify-center rounded-lg border border-border">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <iframe
      src={src}
      title={file.label ?? file.originalName}
      className="h-[55vh] w-full rounded-lg border border-border bg-white"
    />
  );
}

/**
 * Is this one worth drawing rather than listing?
 *
 * The mime type first, because it was decided by reading the bytes rather than
 * trusting the name. The extension is only a fallback for a file stored before
 * that sniffing existed.
 */
function isPdf(file: StoredFile): boolean {
  return (
    file.mimeType === "application/pdf" ||
    file.originalName.toLowerCase().endsWith(".pdf")
  );
}

/**
 * What is attached to one entry, opened from its reference number.
 *
 * Read-only on purpose. The reference in a table is something people click
 * while scanning, often on somebody else's screen, and a delete button one
 * mis-click away from a receipt does not belong there. Attaching and removing
 * stay in the edit form, where the person has already said they are changing
 * this entry.
 *
 * Images and PDFs are shown; anything else gets a row with a download. The API
 * serves bytes from the company's own server behind the session, so an <img>
 * here is a normal authenticated request rather than a public URL. A PDF takes
 * the longer way round — see `PdfFrame`.
 *
 * `kinds` narrows it to what the reader actually clicked. An entry carries the
 * invoice it was against and the bank's record of the payment, and those are
 * reached from different cells; answering both to a click on one of them reads
 * as the app not knowing which is which.
 */
export function DocumentsDialog({
  transactionId,
  owner = "transaction",
  refNo,
  kinds,
  title,
  onClose,
}: {
  /** The row the documents hang on — a transaction, or a subscription. */
  transactionId: string;
  /**
   * Which kind of row that is.
   *
   * A subscription is a money row like any other and carries the same bill and
   * the same bank record, so it reaches the same dialog. Defaulted to
   * `transaction` because that is what every existing caller means, and a
   * required argument here would be four edits to say what was already true.
   */
  owner?: "transaction" | "subscription";
  refNo: string;
  /**
   * Which of the entry's documents this opening is about.
   *
   * An entry carries more than one — the invoice it was against and the bank's
   * own record of the payment — and they are reached from different cells. A
   * click on the invoice number that answers with the bank statement as well
   * is answering a question nobody asked, and on a screen full of numbers it
   * reads as the app not knowing which is which.
   *
   * Left out, everything attached is shown. That is right for a general
   * "documents" affordance and wrong for a specific one.
   */
  kinds?: readonly string[];
  title?: string;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (owner === "subscription"
      ? listSubscriptionFiles(transactionId)
      : listTransactionFiles(transactionId)
    )
      .then((next) => {
        if (live) setFiles(next);
      })
      .catch(() => {
        if (live) setError("Could not read the documents for this entry.");
      });
    return () => {
      live = false;
    };
  }, [transactionId, owner]);

  /**
   * Narrowed to what was actually clicked, and only when a caller says so.
   *
   * Filtered here rather than in the request: the endpoint answers per entry,
   * and asking it twice for two subsets of the same short list would be two
   * round trips for one row of a table.
   */
  const shown = files
    ? kinds
      ? files.filter((file) => kinds.includes(file.kind))
      : files
    : null;

  // Escape closes it. A dialog opened by a stray click on a table cell should
  // be dismissable without aiming at anything.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Documents attached to ${refNo}`}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {title ?? "Attached documents"}
            </p>
            <p className="num truncate text-xs text-muted-foreground">
              {refNo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
              {error}
            </p>
          ) : !files ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Looking…
            </p>
          ) : !shown || shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {kinds && files.length > 0
                ? // Something is attached, just not this. Saying so is the
                  // difference between "you forgot the invoice" and "the app
                  // lost your files".
                  "Nothing of this kind is attached to this entry yet."
                : "Nothing is attached to this entry."}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map((file) => (
                <figure key={file.id} className="flex flex-col gap-2">
                  {file.isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileHref(file.id)}
                      alt={file.label ?? file.originalName}
                      className="max-h-[55vh] w-full rounded-lg border border-border object-contain"
                    />
                  ) : isPdf(file) ? (
                    <PdfFrame file={file} />
                  ) : (
                    /* Neither a picture nor a PDF — a spreadsheet, say. There
                       is nothing to draw, so the row says what it is and the
                       download beside it is the whole affordance. */
                    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                      <FileText className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {file.originalName}
                      </span>
                    </div>
                  )}
                  <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {file.label ?? file.originalName}
                      {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
                    </span>
                    <a
                      href={fileHref(file.id)}
                      download={file.originalName}
                      className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <Download className="size-3.5" />
                      Download
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
