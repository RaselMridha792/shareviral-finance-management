"use client";

import { MAX_FILE_BYTES } from "@finance/shared";
import { Download, FileText, LoaderCircle, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  type StoredFile,
} from "@/lib/api-client";
import {
  listSubscriptionFiles,
  uploadSubscriptionScreenshot,
  type SubscriptionDto,
} from "@/lib/subscriptions";

/**
 * The plan as it looked when it was bought, opened from the tool's name.
 *
 * The reason it is a screenshot and not a note: what a plan includes lives on
 * the vendor's own page, and that page changes without telling anybody. A year
 * later "Max 5x" no longer means what it meant, and the only record of what
 * was actually bought is a picture of it.
 *
 * Uploading replaces rather than adds. The kind is singular on the server, so
 * a second upload retires the first in the same transaction — there is never a
 * moment with two, and no screen has to decide which is current.
 */
export function ScreenshotDialog({
  subscription,
  canWrite,
  onClose,
  onChanged,
}: {
  subscription: SubscriptionDto;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      setFiles(await listSubscriptionFiles(subscription.id));
    } catch {
      setError("Could not read what is attached to this plan.");
    }
  }

  useEffect(() => {
    let live = true;
    listSubscriptionFiles(subscription.id)
      .then((next) => {
        if (live) setFiles(next);
      })
      .catch(() => {
        if (live) setError("Could not read what is attached to this plan.");
      });
    return () => {
      live = false;
    };
  }, [subscription.id]);

  // Escape closes it — this opens from a stray click on a table cell, and
  // should be dismissable without aiming at anything.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onPicked(file: File) {
    setBusy(true);
    setError(null);
    try {
      // Checked here as well as on the server, because a 10 MB upload that is
      // refused after it finishes is a minute of somebody's tethering.
      if (file.size > MAX_FILE_BYTES.subscription_screenshot) {
        setError("That file is over 10 MB. A screenshot should be well under.");
        return;
      }
      await uploadSubscriptionScreenshot(subscription.id, file);
      await reload();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(fileId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteStoredFile(fileId);
      await reload();
      onChanged();
    } catch {
      setError("Could not remove that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Plan screenshot for ${subscription.vendorName} ${subscription.planName}`}
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {subscription.vendorName} — {subscription.planName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {subscription.boughtFor ?? "The plan, as it was bought"}
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
            <p className="mb-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
              {error}
            </p>
          ) : null}

          {!files ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Looking…
            </p>
          ) : files.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No screenshot yet.
              {canWrite
                ? " Attach one so what this plan included is still knowable next year."
                : ""}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {files.map((file) => (
                <figure key={file.id} className="flex flex-col gap-2">
                  {file.isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileHref(file.id)}
                      alt={`${subscription.planName} plan`}
                      className="max-h-[55vh] w-full rounded-lg border border-border object-contain"
                    />
                  ) : (
                    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                      <FileText className="size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {file.originalName}
                      </span>
                    </div>
                  )}
                  <figcaption className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">
                      {file.originalName}
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
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => void remove(file.id)}
                        disabled={busy}
                        className="shrink-0 cursor-pointer font-medium text-negative hover:underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          {canWrite ? (
            <>
              <input
                ref={picker}
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Cleared so picking the same file twice still fires.
                  event.target.value = "";
                  if (file) void onPicked(file);
                }}
              />
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {files && files.length > 0 ? "Replace" : "Attach a screenshot"}
              </Button>
            </>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
