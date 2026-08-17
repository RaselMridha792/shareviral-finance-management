"use client";

import {
  ALLOWED_MIME_TYPES,
  FILE_KIND_LABELS,
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
  listTeamMemberFiles,
  uploadTeamMemberFile,
  type StoredFile,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * A person's papers, one row per kind of paper.
 *
 * The first version was one mixed list with a Type dropdown above an Upload
 * button. It worked and it answered the wrong question: the thing HR needs
 * from this card is not "what has been uploaded" but **"what is still
 * missing"** — whose appointment letter was never filed, who has no NID on
 * record. A list can only ever show what is there.
 *
 * So every kind gets a row whether or not anything sits in it, and an empty
 * row says so and offers the button. More than one file per kind is allowed:
 * a scanned letter is regularly two pages photographed separately.
 */
const SLOTS: readonly FileKind[] = [
  "cv",
  "appointment_letter",
  "salary_certificate",
  "nid",
  "etin_certificate",
  "other",
];

export function DocumentSlots({
  memberId,
  canWrite,
}: {
  memberId: string;
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
        const rows = await listTeamMemberFiles(memberId);
        if (alive) setFiles(rows);
      } catch (caught) {
        if (!alive) return;
        setFiles([]);
        toast.show(
          caught instanceof ApiError
            ? caught.message
            : "Could not load the documents.",
          "error",
        );
      }
    })();
    return () => {
      alive = false;
    };
    // `toast` is stable and listing it would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, reloads]);

  async function onPick(kind: FileKind, file: File | undefined) {
    if (!file) return;

    if (file.size > MAX_FILE_BYTES[kind]) {
      toast.show(
        `That file is ${formatFileSize(file.size)}. ${FILE_KIND_LABELS[kind]} is limited to ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
        "error",
      );
      return;
    }

    setBusyKind(kind);
    try {
      await uploadTeamMemberFile(memberId, file, kind);
      toast.show(`${FILE_KIND_LABELS[kind]} uploaded.`);
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
      <ul className="flex flex-col divide-y divide-border">
        {SLOTS.map((kind) => {
          const held = files.filter((f) => f.kind === kind);
          return (
            <li key={kind} className="flex flex-col gap-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {FILE_KIND_LABELS[kind]}
                </span>
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
                <p className="text-xs text-muted-foreground">Not on file.</p>
              ) : (
                held.map((file) => (
                  <Row
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

function Row({
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

      {/*
        Both open on the page: an image in the lightbox, a document in the
        viewer. It used to open a document in a new tab, which in practice
        meant the browser saved it — and somebody checking whether the letter
        on file is the signed one wants to look at it, not to own a copy of
        it. Saving is a button inside the viewer.
      */}
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
