"use client";

import {
  SIGNATURE_RULE,
  checkPrintableSignature,
  checkSignatureImage,
  type StatementSignatory,
} from "@finance/shared";
import { LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { ApiError, deleteStoredFile, fileHref } from "@/lib/api-client";
import { reportsApi } from "@/lib/reports";

/**
 * Who signed the statement, and what their signature looks like.
 *
 * Laid out as the closing page lays it out — two cards across, up to four,
 * each holding a name, a title and the mark itself. The screen and the
 * document being the same shape is the point: this block is the only preview
 * anybody gets of a PDF they will not open until it is being sent somewhere.
 *
 * The rules are printed before a file is chosen rather than only after one is
 * refused. That was the owner's instruction for the payslip signature and it
 * is the same instruction here — a limit nobody can read until they have
 * already broken it is half a rule.
 */

/** The most the statement schema will store. */
const MAX_SIGNATORIES = 4;

export function SignatoryFields({
  signatories,
  onChange,
  period,
  disabled,
}: {
  signatories: StatementSignatory[];
  onChange: (next: StatementSignatory[]) => void;
  /** Which statement the uploaded file hangs on. */
  period: { start: string; end: string };
  /**
   * True while the screen is drawing a sample. Uploading then would attach a
   * real file to a real period on the strength of invented figures.
   */
  disabled: boolean;
}) {
  const edit = (at: number, patch: Partial<StatementSignatory>) =>
    onChange(
      signatories.map((person, i) =>
        i === at ? { ...person, ...patch } : person,
      ),
    );

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Signed by</h3>
          <p className="text-xs text-muted-foreground">
            Up to {MAX_SIGNATORIES}. Each one prints on the closing page of the
            PDF, in the order they are listed here.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={disabled || signatories.length >= MAX_SIGNATORIES}
          onClick={() =>
            onChange([
              ...signatories,
              { name: "", title: "", signatureFileId: null },
            ])
          }
        >
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      {signatories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          Nobody has signed this statement. The PDF prints one empty block
          marked &ldquo;Prepared by&rdquo; until somebody does.
        </p>
      ) : (
        /*
         * Two across from `sm` up, which is the grid the PDF draws. One across
         * below it: a 160px card holding two inputs and an image is narrower
         * than the signature it is previewing.
         */
        <div className="grid gap-3 sm:grid-cols-2">
          {signatories.map((person, i) => (
            <SignatoryCard
              key={i}
              index={i}
              person={person}
              period={period}
              disabled={disabled}
              onEdit={(patch) => edit(i, patch)}
              onRemove={() =>
                onChange(signatories.filter((_, at) => at !== i))
              }
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{SIGNATURE_RULE}</p>
    </div>
  );
}

function SignatoryCard({
  index,
  person,
  period,
  disabled,
  onEdit,
  onRemove,
}: {
  index: number;
  person: StatementSignatory;
  period: { start: string; end: string };
  disabled: boolean;
  onEdit: (patch: Partial<StatementSignatory>) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

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

  /**
   * Refused here and refused again on the server, both through the same two
   * functions from the shared package — so what the screen says and what the
   * endpoint says cannot come apart. This side exists to save a round trip and
   * to name the problem while the file picker is still fresh in mind; the
   * server's copy is the one that actually holds.
   */
  async function onPicked(chosen: File) {
    setBusy(true);
    setError(null);
    try {
      const size = await measure(chosen);
      if (!size) {
        setError("That file does not read as an image.");
        return;
      }

      const shape = checkSignatureImage({
        ...size,
        sizeBytes: chosen.size,
        mimeType: chosen.type,
      });
      if (!shape.ok) {
        setError(shape.reason);
        return;
      }

      // And whether a PDF can draw it at all. An interlaced PNG opens fine in
      // every browser and cannot be embedded, which would show up a month
      // later as an empty signature box on the document being sent out.
      const printable = checkPrintableSignature(
        new Uint8Array(await chosen.arrayBuffer()),
      );
      if (!printable.ok) {
        setError(printable.reason);
        return;
      }

      const stored = await reportsApi.uploadStatementSignature(period, chosen);
      const replaced = person.signatureFileId;
      onEdit({ signatureFileId: stored.id });

      // The one it replaced goes now rather than at the next save. Nothing
      // points at it any more, and a statement quietly accumulating every
      // rejected scan of somebody's signature is the leak the orphan sweep
      // exists to find.
      if (replaced) await deleteStoredFile(replaced).catch(() => {});
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const gone = person.signatureFileId;
    if (!gone) return;
    setBusy(true);
    setError(null);
    try {
      onEdit({ signatureFileId: null });
      await deleteStoredFile(gone);
    } catch {
      setError("Could not remove that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Signatory {index + 1}
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          aria-label={`Remove signatory ${index + 1}`}
          disabled={disabled || busy}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Input
        aria-label={`Signatory ${index + 1} name`}
        placeholder="Name"
        value={person.name}
        disabled={disabled}
        onChange={(event) => onEdit({ name: event.target.value })}
      />
      <Input
        aria-label={`Signatory ${index + 1} title`}
        placeholder="Title"
        value={person.title}
        disabled={disabled}
        onChange={(event) => onEdit({ title: event.target.value })}
      />

      {/*
        On white, always — and it is the same slip of paper the PDF draws under
        the ink. A signature is dark on a transparent background, and on this
        app's dark card it would be invisible, which reads as a failed upload
        rather than a successful one.
      */}
      {person.signatureFileId ? (
        <div className="flex h-16 items-center justify-center rounded-md border border-border bg-white px-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileHref(person.signatureFileId)}
            alt={`${person.name || "This signatory"}'s signature`}
            className="max-h-12 w-auto object-contain"
          />
        </div>
      ) : (
        <p className="flex h-16 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
          No signature. The PDF prints a ruled line with the name under it.
        </p>
      )}

      {error ? <p className="text-xs text-negative">{error}</p> : null}

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
          type="button"
          disabled={disabled || busy}
          onClick={() => picker.current?.click()}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {person.signatureFileId ? "Replace" : "Upload signature"}
        </Button>
        {person.signatureFileId ? (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={disabled || busy}
            className="cursor-pointer text-xs font-medium text-negative hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
