"use client";

import { SIGNATURE_RULE, checkSignatureImage } from "@finance/shared";
import { LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  listSignature,
  uploadSignature,
  type StoredFile,
} from "@/lib/api-client";

/**
 * The signature that prints at the foot of a payslip.
 *
 * The rule is stated before a file is chosen, not only after one is refused —
 * the owner asked for it to be "mentioned and required", and a limit nobody
 * can read until they have already broken it is only half of that.
 *
 * The refusal happens twice on purpose. Here, so somebody learns immediately
 * and without a round trip; and again on the server, because a check in a
 * browser is a courtesy rather than a gate. Both call the same function, so
 * neither can start saying something the other does not.
 */
export function SignatureField({ canWrite }: { canWrite: boolean }) {
  const [file, setFile] = useState<StoredFile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function reload() {
    const found = await listSignature();
    setFile(found[0] ?? null);
  }

  useEffect(() => {
    let live = true;
    listSignature()
      .then((found) => {
        if (live) setFile(found[0] ?? null);
      })
      .catch(() => {
        if (live) setError("Could not read the signature on file.");
      });
    return () => {
      live = false;
    };
  }, []);

  /**
   * The image's real dimensions, which only the browser can give us before the
   * upload. The object URL is revoked either way — a leaked one holds the whole
   * file in memory for the life of the page.
   */
  function measure(chosen: File) {
    return new Promise<{ width: number; height: number } | null>((resolve) => {
      const url = URL.createObjectURL(chosen);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      image.src = url;
    });
  }

  async function onPicked(chosen: File) {
    setBusy(true);
    setError(null);
    try {
      const size = await measure(chosen);
      if (!size) {
        setError("That file does not read as an image.");
        return;
      }

      const verdict = checkSignatureImage({
        ...size,
        sizeBytes: chosen.size,
        mimeType: chosen.type,
      });
      if (!verdict.ok) {
        setError(verdict.reason);
        return;
      }

      await uploadSignature(chosen);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await deleteStoredFile(file.id);
      setFile(null);
    } catch {
      setError("Could not remove that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Signature</p>

      {/* Said up front. The whole point of the owner's instruction. */}
      <p className="text-xs text-muted-foreground">{SIGNATURE_RULE}</p>

      {file === undefined ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Looking…
        </p>
      ) : file ? (
        // On white, always. A signature is black ink on a transparent
        // background, and on this app's dark card it would be invisible — which
        // reads as a failed upload rather than a successful one.
        <div className="flex w-fit items-center rounded-lg border border-border bg-white px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileHref(file.id)}
            alt="The signature that prints on payslips"
            className="h-14 w-auto object-contain"
          />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          Nothing on file. Payslips print the signatory&apos;s name over the
          rule, and nothing above it.
        </p>
      )}

      {error ? <p className="text-xs text-negative">{error}</p> : null}

      {canWrite ? (
        <div className="flex items-center gap-2">
          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              // Cleared so picking the same file twice still fires — which is
              // exactly what somebody does after cropping it.
              event.target.value = "";
              if (chosen) void onPicked(chosen);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {file ? "Replace" : "Upload a signature"}
          </Button>
          {file ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="cursor-pointer text-xs font-medium text-negative hover:underline"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
