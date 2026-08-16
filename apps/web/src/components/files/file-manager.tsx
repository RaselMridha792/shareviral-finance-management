"use client";

import {
  ALLOWED_MIME_TYPES,
  FILE_KIND_LABELS,
  formatFileSize,
  MAX_FILE_BYTES,
  type FileKind,
} from "@finance/shared";
import {
  Download,
  FileText,
  ImageIcon,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  listTeamMemberFiles,
  listTransactionFiles,
  uploadTeamMemberFile,
  uploadTransactionFile,
  type StoredFile,
} from "@/lib/api-client";

type Owner = "team_member" | "transaction";

/**
 * The files a record holds, and the controls to add one.
 *
 * Every row here is fetched from the API rather than from a path on disk, so a
 * document is exactly as private as the record it hangs on — nginx serves none
 * of this, and a URL on its own opens nothing without a session that is allowed
 * the thing it belongs to.
 */
export function FileManager({
  owner,
  ownerId,
  kinds,
  canWrite,
  emptyLabel = "Nothing uploaded yet.",
}: {
  owner: Owner;
  ownerId: string;
  kinds: readonly FileKind[];
  canWrite: boolean;
  emptyLabel?: string;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [kind, setKind] = useState<FileKind>(kinds[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredFile | null>(null);
  const toast = useToast();

  /** Ask for the list again — after an upload, or after a delete. */
  const reload = () => setReloads((n) => n + 1);

  useEffect(() => {
    /**
     * `alive` guards against the answer arriving after the question stopped
     * mattering. Open one person, click straight through to another, and the
     * slower of the two requests would otherwise land last and show the first
     * person's documents under the second person's name.
     */
    let alive = true;

    void (async () => {
      try {
        const rows =
          owner === "team_member"
            ? await listTeamMemberFiles(ownerId)
            : await listTransactionFiles(ownerId);
        if (alive) setFiles(rows);
      } catch (caught) {
        if (!alive) return;
        setError(
          caught instanceof ApiError ? caught.message : "Could not load files.",
        );
        setFiles([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [owner, ownerId, reloads]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);

    /**
     * Checked here as well as on the server, and the server's answer is still
     * the one that counts. This exists so a 14 MB scan is refused in the
     * moment rather than after it has been uploaded over a phone connection
     * and then rejected.
     */
    if (file.size > MAX_FILE_BYTES[kind]) {
      setError(
        `That file is ${formatFileSize(file.size)}. ${FILE_KIND_LABELS[kind]} is limited to ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      if (owner === "team_member") {
        await uploadTeamMemberFile(ownerId, file, kind);
      } else {
        await uploadTransactionFile(ownerId, file, kind);
      }
      toast.show("Uploaded.");
      reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
      );
    } finally {
      setBusy(false);
      // So picking the same file again after a failure still fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onDelete(file: StoredFile) {
    setBusy(true);
    setError(null);
    try {
      await deleteStoredFile(file.id);
      toast.show(`${file.originalName} removed.`);
      reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not remove that.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {files === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading…
        </p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
            >
              {file.isImage ? (
                // Not next/image: these are private bytes behind a permission
                // check on another origin, and the optimiser would need to
                // fetch them itself, without the browser's session.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={fileHref(file.id)}
                  alt={file.originalName}
                  loading="lazy"
                  className="size-10 shrink-0 rounded object-cover"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded bg-surface-muted text-muted-foreground">
                  <FileText className="size-4" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {file.originalName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {FILE_KIND_LABELS[file.kind as FileKind]} ·{" "}
                  {formatFileSize(file.sizeBytes)}
                  {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
                </p>
              </div>

              <a
                href={fileHref(file.id)}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                aria-label={`Open ${file.originalName}`}
              >
                <Download className="size-4" />
              </a>

              {canWrite ? (
                <button
                  type="button"
                  onClick={() => setPendingDelete(file)}
                  disabled={busy}
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={`Remove ${file.originalName}`}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
          {kinds.length > 1 ? (
            <Field label="Type">
              <Select
                value={kind}
                onChange={(event) => setKind(event.target.value as FileKind)}
              >
                {kinds.map((option) => (
                  <option key={option} value={option}>
                    {FILE_KIND_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ALLOWED_MIME_TYPES[kind].join(",")}
            onChange={(event) => void onPick(event.target.files?.[0])}
          />

          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Upload {FILE_KIND_LABELS[kind].toLowerCase()}
          </Button>

          <p className="text-xs text-muted-foreground">
            Up to {formatFileSize(MAX_FILE_BYTES[kind])}. Stored on this
            company&apos;s own server.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this file?"
        destructive
        confirmLabel="Remove it"
        body={
          <>
            <span className="font-medium text-foreground">
              {pendingDelete?.originalName}
            </span>{" "}
            will be deleted from this company&apos;s server. The audit log keeps
            the record that it existed; the file itself cannot be recovered.
          </>
        }
        onConfirm={() => {
          const file = pendingDelete;
          setPendingDelete(null);
          if (file) void onDelete(file);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** The photograph on its own — one file, replaced rather than added to. */
export function PhotoUpload({
  memberId,
  onUploaded,
}: {
  memberId: string;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (file.size > MAX_FILE_BYTES.profile_photo) {
      setError(
        `That photo is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_FILE_BYTES.profile_photo)}.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setBusy(true);
    try {
      await uploadTeamMemberFile(memberId, file, "profile_photo");
      toast.show("Photo updated.");
      onUploaded();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={ALLOWED_MIME_TYPES.profile_photo.join(",")}
        onChange={(event) => void onPick(event.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition hover:underline disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle className="size-3 animate-spin" />
        ) : (
          <ImageIcon className="size-3" />
        )}
        Change photo
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
