"use client";

import {
  ALLOWED_MIME_TYPES,
  formatFileSize,
  MAX_FILE_BYTES,
} from "@finance/shared";
import { Paperclip, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PreviewButton,
  useFilePreview,
  type Stored,
} from "@/components/files/file-preview";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  listTransactionFiles,
  type StoredFile,
} from "@/lib/api-client";
import { listSubscriptionFiles } from "@/lib/subscriptions";
import { cn } from "@/lib/utils";

/**
 * The two papers a money form asks for, and what is already on file for each.
 *
 * The owner, on Cash In: *"edit a click korar por ekhane invoice and Reference
 * preview dekhacchena and eksathe multiple add hoye geche edit mode theke
 * remove o kora jacchena."* The entry's popup said "Invoice — 2 attached" and
 * the form opened on the same entry said "No invoice attached". The form only
 * ever knew about files picked in THIS sitting, so a correction opened blind
 * to the paper already filed — and the natural response to "No invoice
 * attached" is to attach it again, which is exactly how one entry came to
 * carry two of each. Nothing on the form could take the extra copy off.
 *
 * So the clip now shows both: what is on file (openable, and removable), and
 * what has just been picked. A removal is held until the form is saved, the
 * same as a pick is — Cancel means nothing changed, on either side.
 *
 * This was copied into three forms (Cash In, the ledger form, Money Transfer)
 * with the note "if a third screen ever needs it, it should move into a module
 * of its own". It is here now, once.
 */

/** The two slots, under the kinds the ledger already uses. */
export type ClipKind = "invoice" | "bank_statement";

/**
 * Which stored kinds each slot shows.
 *
 * The same split the API counts by (`invoiceCount` / `recordCount` in
 * transactions.service.ts): the invoice is its own kind, and everything else
 * attached to an entry — the bank's slip, a receipt, a photo of something — is
 * the record behind the movement, which is what the Reference column opens.
 * A slot that showed fewer kinds than its column counts would say "No
 * reference attached" beside a table that says "View".
 */
export const SLOT_KINDS: Record<ClipKind, readonly string[]> = {
  invoice: ["invoice"],
  bank_statement: ["bank_statement", "receipt", "other"],
};

type Owner = "transaction" | "subscription";

/**
 * The papers already on one record, and the ones marked to come off it.
 *
 * `ownerId` undefined is a new record: nothing is on file and nothing is
 * fetched. Both pieces of state are keyed by the record they were read for, so
 * a form reused for a different entry can never show the last entry's papers
 * or remove them.
 */
export function useStoredPapers(owner: Owner, ownerId: string | undefined) {
  const [read, setRead] = useState<{
    ownerId: string;
    files: StoredFile[] | null;
  } | null>(null);
  const [marked, setMarked] = useState<{ ownerId: string; ids: string[] }>({
    ownerId: "",
    ids: [],
  });

  /*
   * A form that closes and opens again on the same record without being
   * remounted passes `undefined` in between (callers hand in the id only
   * while open). Forgetting both lists at that moment is what makes the next
   * opening read the record afresh, rather than showing — and offering to
   * remove — papers a previous sitting already took off. Done while
   * rendering, like the other resets in these forms, so no frame shows the
   * old list.
   */
  const [seen, setSeen] = useState(ownerId);
  if (seen !== ownerId) {
    setSeen(ownerId);
    setRead(null);
    setMarked({ ownerId: "", ids: [] });
  }

  useEffect(() => {
    if (!ownerId) return;
    let alive = true;
    (owner === "subscription"
      ? listSubscriptionFiles(ownerId)
      : listTransactionFiles(ownerId)
    )
      .then((files) => {
        if (alive) setRead({ ownerId, files });
      })
      .catch(() => {
        // Null, not []: "could not look" must not read as "nothing there".
        if (alive) setRead({ ownerId, files: null });
      });
    return () => {
      alive = false;
    };
  }, [owner, ownerId]);

  const current = ownerId && read?.ownerId === ownerId ? read : null;
  const removing = ownerId && marked.ownerId === ownerId ? marked.ids : [];

  return {
    /** Loading, or nothing to load. */
    loading: Boolean(ownerId) && !current,
    /** The list could not be read. */
    failed: Boolean(current && current.files === null),
    /** What is on file in one slot. Empty on a new record. */
    of(kind: ClipKind): StoredFile[] {
      return (current?.files ?? []).filter((file) =>
        SLOT_KINDS[kind].includes(file.kind),
      );
    },
    /** Ids marked to come off when the form is saved. */
    removing,
    /** Marks a stored paper to come off, or takes the mark back. */
    toggle(file: StoredFile) {
      if (!ownerId) return;
      setMarked((previous) => {
        const ids = previous.ownerId === ownerId ? previous.ids : [];
        return {
          ownerId,
          ids: ids.includes(file.id)
            ? ids.filter((id) => id !== file.id)
            : [...ids, file.id],
        };
      });
    },
    /**
     * Takes the marked papers off, now that the save went through.
     *
     * One at a time and never throwing, like the uploads beside it: the entry
     * is already saved, so a failure is named rather than reported as the save
     * having failed. Returns what could not be removed.
     */
    async commit(): Promise<{ name: string; reason: string }[]> {
      const failures: { name: string; reason: string }[] = [];
      const files = current?.files ?? [];
      for (const id of removing) {
        const file = files.find((one) => one.id === id);
        try {
          await deleteStoredFile(id);
        } catch (caught) {
          failures.push({
            name: file?.originalName ?? "a document",
            reason:
              caught instanceof ApiError
                ? caught.message
                : "The removal did not go through.",
          });
        }
      }
      return failures;
    },
  };
}

export type StoredPapers = ReturnType<typeof useStoredPapers>;

/** A stored paper as the preview hook takes it. */
export function asPreview(file: StoredFile): Stored {
  return {
    name: file.originalName,
    href: fileHref(file.id),
    isImage: file.isImage,
  };
}

/**
 * The same file, judged the way the picker judges a second click: by name and
 * size. The server stores the name it was given (made safe), so an ordinary
 * file name comes back exactly as it went up.
 */
export function sameAsStored(picked: File, stored: StoredFile): boolean {
  return picked.name === stored.originalName && picked.size === stored.sizeBytes;
}

/**
 * One paper already on file: its name, an eye, and a cross that marks it to
 * come off when the form is saved. A marked one stays in the list, struck
 * through, with the cross turned into an undo — so a slip of the mouse is one
 * click to take back, and nobody has to wonder where it went.
 */
export function StoredPaperLine({
  file,
  removing,
  onToggle,
  onPreview,
  count,
}: {
  file: StoredFile;
  removing: boolean;
  onToggle?: () => void;
  onPreview: () => void;
  /** How many papers the eye opens, when it opens several. */
  count?: number;
}) {
  return (
    <span
      data-attached="stored"
      data-file-id={file.id}
      data-removing={removing ? "" : undefined}
      className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
    >
      <span
        className={cn(
          "truncate font-medium",
          removing ? "text-faint line-through" : "text-foreground",
        )}
      >
        {file.originalName}
      </span>
      {removing ? (
        <span className="shrink-0 text-negative">removed on save</span>
      ) : (
        <PreviewButton
          name={file.originalName}
          count={count}
          onClick={onPreview}
        />
      )}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={
            removing
              ? `Keep ${file.originalName}`
              : `Remove ${file.originalName}`
          }
          title={removing ? "Keep it" : "Remove it when this is saved"}
          className="shrink-0 cursor-pointer rounded p-0.5 transition hover:bg-surface-muted hover:text-foreground"
        >
          {removing ? <Undo2 className="size-3" /> : <X className="size-3" />}
        </button>
      ) : null}
    </span>
  );
}

/**
 * The paperclip beside a field, with what is on file and what has been picked.
 *
 * Nothing is uploaded or removed from here — picks are handed up and held until
 * the entry has an id for them to hang on, and removals are held until the
 * form is saved.
 */
export function AttachClip({
  kind,
  name,
  files,
  onPick,
  papers,
  emptyLabel,
}: {
  kind: ClipKind;
  /** What the paper is called in the button's label — "invoice". */
  name: string;
  /**
   * Everything clipped here in this sitting, not one thing.
   *
   * The owner: "multiple documents upload korar option thakte hobe". An
   * invoice can be two pages photographed separately, a bank slip can be the
   * confirmation and the statement line.
   */
  files: File[];
  onPick: (files: File[]) => void;
  /** What is already on the record. Left out on a form that only records. */
  papers?: StoredPapers;
  /** Said when there is nothing on file and nothing picked. */
  emptyLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const preview = useFilePreview();

  const stored = papers ? papers.of(kind) : [];
  const removing = papers?.removing ?? [];
  const kept = stored.filter((file) => !removing.includes(file.id));

  /**
   * Everything just chosen, judged together and appended in one go.
   *
   * One pass rather than a loop of single adds: each `onPick` is a setState
   * the parent has not re-rendered from yet, so three separate calls would
   * each build on the ORIGINAL list and only the last would survive.
   */
  function choose(chosenFiles: File[]) {
    // Emptied straight away so picking the same file again — after clearing
    // it, or after it was refused — still counts as a change.
    if (inputRef.current) inputRef.current.value = "";
    if (chosenFiles.length === 0) return;

    const additions: File[] = [];
    const same = (a: File, b: File) => a.name === b.name && a.size === b.size;

    for (const picked of chosenFiles) {
      /*
       * The same file twice is almost always a second click rather than a
       * second page, and a duplicate upload is not undone by removing one of
       * them. Checked against what is already ON FILE as well as what this
       * sitting has picked — the check that was missing when a correction
       * opened blind to the stored paper and the owner attached it again.
       */
      if (
        files.some((f) => same(f, picked)) ||
        additions.some((f) => same(f, picked)) ||
        kept.some((f) => sameAsStored(picked, f))
      ) {
        setRejected("That one is already attached.");
        continue;
      }

      /**
       * Refused here as well as by the server, which reads the bytes and has
       * the final say. This exists so the answer arrives while the file is
       * being chosen, rather than after the entry is saved.
       */
      const allowed: readonly string[] = ALLOWED_MIME_TYPES[kind];
      if (picked.type && !allowed.includes(picked.type)) {
        setRejected("Only JPEG, PNG, WebP and PDF can be stored.");
        continue;
      }
      if (picked.size > MAX_FILE_BYTES[kind]) {
        setRejected(
          `That is ${formatFileSize(picked.size)}; the limit is ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
        );
        continue;
      }

      additions.push(picked);
    }

    if (additions.length > 0) {
      setRejected(null);
      onPick([...files, ...additions]);
    }
  }

  /*
   * The eye opens the WHOLE set from the one clicked — what is on file first,
   * then what was just picked — because somebody checking their attachments is
   * checking all of them, not one.
   */
  const all: (File | Stored)[] = [...kept.map(asPreview), ...files];
  const nothing = kept.length === 0 && files.length === 0;

  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {papers?.loading
            ? "Checking what is attached…"
            : papers?.failed
              ? "Could not check what is already attached."
              : nothing
                ? emptyLabel
                : ""}
        </span>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          // Every camera roll and every scanner, as asked. The server keeps a
          // narrower list than this and says so if it has to; `choose` says it
          // first, in the moment.
          accept="image/*,application/pdf"
          onChange={(event) => choose([...(event.target.files ?? [])])}
        />

        {/* A button rather than the file input itself: a bare one renders as a
          browser-styled control too wide to sit beside a text box, and the
          label that would normally dress it cannot nest inside the label
          `Field` already is. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="size-9 shrink-0 px-0"
          title={`Attach the ${name}`}
          aria-label={`Attach the ${name}`}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
      </span>

      {rejected ? (
        <span className="text-xs text-negative">{rejected}</span>
      ) : null}

      {stored.map((file) => {
        const gone = removing.includes(file.id);
        return (
          <StoredPaperLine
            key={file.id}
            file={file}
            removing={gone}
            count={all.length}
            onToggle={papers ? () => papers.toggle(file) : undefined}
            onPreview={() =>
              preview.show(
                all,
                kept.findIndex((one) => one.id === file.id),
              )
            }
          />
        );
      })}

      {/*
        One line per paper picked in this sitting, each with its own eye and
        its own cross. The name reads as content, not as a caption — the owner:
        "upload document gular name color change hobe."
      */}
      {files.map((one, index) => (
        <span
          key={`${one.name}-${one.size}-${index}`}
          data-attached="picked"
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="truncate font-medium text-foreground">
            {one.name}
          </span>
          <PreviewButton
            name={one.name}
            count={all.length}
            onClick={() => preview.show(all, kept.length + index)}
          />
          <button
            type="button"
            onClick={() => onPick(files.filter((_, i) => i !== index))}
            aria-label={`Remove ${one.name}`}
            className="shrink-0 cursor-pointer rounded p-0.5 transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {preview.overlay}
    </span>
  );
}
