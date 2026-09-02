"use client";

import {
  ALLOWED_MIME_TYPES,
  formatFileSize,
  MAX_FILE_BYTES,
  type FileKind,
} from "@finance/shared";
import { Eye, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ConfirmDialog,
  DocumentViewer,
  ImageLightbox,
} from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  listPayrollRunFiles,
  uploadPayrollRunFile,
  type StoredFile,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The month's paperwork, on the sheet it belongs to.
 *
 * Two slots rather than one mixed list, for the same reason a team member's
 * card has slots: what somebody wants from this panel is not "what has been
 * uploaded" but *"is this month's paper on file yet"*, and a list can only
 * ever show what is there. An empty slot says so.
 *
 * The labels are **Invoice** and **Reference** — what this pair is called on
 * every other money table in the app — rather than the kinds' own names. The
 * owner asked for the names to stand while he decides what actually goes in
 * them: *"tumi invoice name rakho pore ami dekhe nibo ki upload korar dorkar
 * hoy"*.
 *
 * More than one file per slot is allowed, because a bank advice is regularly
 * several pages photographed separately. And the slot is offered from the
 * moment the run exists, draft included — which is the whole reason the file
 * hangs on the run rather than on the salary transaction the run writes when
 * it is paid: *"payroll toiri korar somoy"*.
 */
const SLOTS: readonly { kind: FileKind; label: string; hint: string }[] = [
  { kind: "invoice", label: "Invoice", hint: "The bill for this month." },
  {
    kind: "bank_statement",
    label: "Reference",
    hint: "The bank's record of paying it.",
  },
];

export function RunDocuments({
  runId,
  canWrite,
}: {
  runId: string;
  canWrite: boolean;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [reloads, setReloads] = useState(0);
  const [busyKind, setBusyKind] = useState<FileKind | null>(null);
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredFile | null>(null);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await listPayrollRunFiles(runId);
        if (alive) setFiles(rows);
      } catch (caught) {
        if (!alive) return;
        setFiles([]);
        toast.show(
          caught instanceof ApiError
            ? caught.message
            : "Could not load this run's documents.",
          "error",
        );
      }
    })();
    return () => {
      alive = false;
    };
    // `toast` is stable and listing it would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, reloads]);

  async function onPick(kind: FileKind, file: File | undefined) {
    if (!file) return;

    if (file.size > MAX_FILE_BYTES[kind]) {
      toast.show(
        `That file is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
        "error",
      );
      return;
    }

    setBusyKind(kind);
    try {
      await uploadPayrollRunFile(runId, file, kind);
      toast.show(`${labelOf(kind)} uploaded.`);
      setReloads((n) => n + 1);
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
        "error",
      );
    } finally {
      setBusyKind(null);
    }
  }

  async function confirmDelete() {
    const file = pendingDelete;
    if (!file) return;
    setPendingDelete(null);
    try {
      await deleteStoredFile(file.id);
      toast.show(`${file.originalName} removed.`);
      setReloads((n) => n + 1);
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : "Could not remove that.",
        "error",
      );
    }
  }

  if (files === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        Loading…
      </p>
    );
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2">
        {SLOTS.map(({ kind, label, hint }) => {
          const held = files.filter((f) => f.kind === kind);
          return (
            <li key={kind} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{label}</span>
                {canWrite ? (
                  <UploadButton
                    kind={kind}
                    busy={busyKind === kind}
                    replacing={held.length > 0}
                    onPick={(file) => void onPick(kind, file)}
                  />
                ) : null}
              </div>

              {held.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Not on file. {hint}
                </p>
              ) : (
                held.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    canWrite={canWrite}
                    onPreview={() => setPreview(file)}
                    onDelete={() => setPendingDelete(file)}
                  />
                ))
              )}
            </li>
          );
        })}
      </ul>

      <ImageLightbox
        open={Boolean(preview?.isImage)}
        src={preview ? fileHref(preview.id) : null}
        alt={preview?.originalName ?? ""}
        onClose={() => setPreview(null)}
      />

      <DocumentViewer
        open={Boolean(preview && !preview.isImage)}
        src={preview ? `${fileHref(preview.id)}?inline=1` : null}
        name={preview?.originalName ?? ""}
        downloadHref={preview ? fileHref(preview.id) : ""}
        onClose={() => setPreview(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this document?"
        destructive
        confirmLabel="Remove it"
        body={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.originalName}
            </span>{" "}
            will be deleted from this company&apos;s server. The record that it
            existed stays in the audit log, but the file itself cannot be
            recovered.
          </>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

function labelOf(kind: FileKind) {
  return SLOTS.find((slot) => slot.kind === kind)?.label ?? "Document";
}

function FileRow({
  file,
  canWrite,
  onPreview,
  onDelete,
}: {
  file: StoredFile;
  canWrite: boolean;
  onPreview: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
      {file.isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fileHref(file.id)}
          alt={file.originalName}
          loading="lazy"
          className="size-9 shrink-0 cursor-zoom-in rounded object-cover"
          onClick={onPreview}
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-surface-muted text-muted-foreground">
          <FileText className="size-4" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{file.originalName}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(file.sizeBytes)}
          {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
        </p>
      </div>

      {/* Both open on the page — an image in the lightbox, a document in the
          viewer — rather than in a new tab, which in practice means the
          browser saves it. Somebody checking whether the right advice is on
          file wants to look at it, not to own a copy. */}
      <IconButton label={`View ${file.originalName}`} onClick={onPreview}>
        <Eye className="size-4" />
      </IconButton>

      {canWrite ? (
        <IconButton
          label={`Remove ${file.originalName}`}
          destructive
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
        </IconButton>
      ) : null}
    </div>
  );
}

function UploadButton({
  kind,
  busy,
  replacing,
  onPick,
}: {
  kind: FileKind;
  busy: boolean;
  replacing: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_MIME_TYPES[kind].join(",")}
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          // So choosing the same file again after a failure still fires.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition hover:underline disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : (
          <Upload className="size-3" />
        )}
        {replacing ? "Add another" : "Upload"}
      </button>
    </>
  );
}

function IconButton({
  label,
  destructive,
  onClick,
  children,
}: {
  label: string;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground transition",
        destructive
          ? "hover:bg-negative/10 hover:text-negative"
          : "hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
