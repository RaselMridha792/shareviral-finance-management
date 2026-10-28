"use client";

import { ALLOWED_MIME_TYPES } from "@finance/shared";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCan } from "@/components/auth/session-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { Drawer } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import {
  ApiError,
  deleteStoredFile,
  fileHref,
  listTransactionFiles,
  uploadTransactionFile,
  type StoredFile,
} from "@/lib/api-client";
import type { PayrollLineDto } from "@/lib/payroll";

/** The kinds a payment's Reference counts, as All transactions counts them. */
const REFERENCE_KINDS = ["bank_statement", "receipt", "other"] as const;

const iconButton =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-link transition hover:bg-(--sv-violet-tint) disabled:cursor-default disabled:opacity-50";

/**
 * Proof this person was paid: the screenshot of their transfer.
 *
 * The owner, 27 Oct 2026: a Reference column where each person's screenshot
 * is uploaded. It hangs on the line's PAYMENT row, as that entry's bank
 * record — so the same screenshot is its Reference on All transactions too.
 *
 * Three icons and no words (the owner, 28 Oct 2026, after uploading two by
 * mistake with no way back): see, add, remove. Removing opens the list, so
 * the one to go is picked by name and confirmed, not guessed at.
 *
 * A line not yet paid has no payment to prove, and says so.
 */
export function ProofControls({
  line,
  onChanged,
}: {
  line: PayrollLineDto;
  onChanged: () => void;
}) {
  const canWrite = useCan("transactions.write");
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [managing, setManaging] = useState(false);

  const paymentId = line.isPaid ? line.transactionId : null;
  const count = line.referenceCount ?? 0;

  async function onPick(files: FileList | null) {
    if (!paymentId || !files?.length) return;
    setBusy(true);
    let done = 0;
    try {
      // One at a time, so a refusal names the file it refused.
      for (const file of Array.from(files)) {
        await uploadTransactionFile(paymentId, file, "bank_statement");
        done += 1;
      }
      toast.show(
        done === 1 ? "Screenshot uploaded." : `${done} screenshots uploaded.`,
      );
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : "Could not upload that.",
        "error",
      );
    } finally {
      setBusy(false);
      if (done > 0) onChanged();
    }
  }

  if (!paymentId) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Pay the sheet first"
      >
        N/A
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {count > 0 ? (
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={`View the screenshot${count > 1 ? "s" : ""}`}
          title="View"
          className={`${iconButton} w-auto gap-1 px-1.5 text-[13px] font-extrabold`}
        >
          <EyeIcon weight="duotone" size={17} />
          {count > 1 ? <span className="num">{count}</span> : null}
        </button>
      ) : null}
      {canWrite ? (
        <>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            accept={ALLOWED_MIME_TYPES.bank_statement.join(",")}
            onChange={(event) => {
              void onPick(event.target.files);
              // So choosing the same file again after a failure still fires.
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            aria-label="Add a screenshot"
            title="Add"
            className={iconButton}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <PlusCircleIcon weight="duotone" size={17} />
            )}
          </button>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => setManaging(true)}
              aria-label="Remove a screenshot"
              title="Remove"
              className={`${iconButton} text-negative hover:bg-negative/10`}
            >
              <TrashIcon weight="duotone" size={17} />
            </button>
          ) : null}
        </>
      ) : count === 0 ? (
        <span className="text-xs text-muted-foreground">N/A</span>
      ) : null}

      {/* Out of the table, so the row it was opened from — sticky cells,
          hover — has no say in where it sits or what covers it. */}
      {viewing
        ? createPortal(
            <DocumentsDialog
              transactionId={paymentId}
              refNo={line.fullName}
              kinds={REFERENCE_KINDS}
              title="Reference"
              onClose={() => setViewing(false)}
            />,
            document.body,
          )
        : null}
      <RemoveProof
        open={managing}
        paymentId={paymentId}
        name={line.fullName}
        onClose={() => setManaging(false)}
        onRemoved={onChanged}
      />
    </div>
  );
}

/** The salary sheet's Reference cell. */
export function PaymentProofCell({
  line,
  onChanged,
}: {
  line: PayrollLineDto;
  onChanged: () => void;
}) {
  return (
    <td>
      <ProofControls line={line} onChanged={onChanged} />
    </td>
  );
}

/**
 * Pick a screenshot and take it off.
 *
 * Its own small list rather than a delete button inside the viewer: the
 * viewer is read-only on purpose (a mis-click while reading must not lose a
 * receipt), and here somebody has already said they mean to remove one.
 */
function RemoveProof({
  open,
  paymentId,
  name,
  onClose,
  onRemoved,
}: {
  open: boolean;
  paymentId: string;
  name: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [asking, setAsking] = useState<StoredFile | null>(null);
  const [pending, setPending] = useState(false);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    listTransactionFiles(paymentId)
      .then((rows) => {
        if (alive)
          setFiles(
            rows.filter((f) =>
              (REFERENCE_KINDS as readonly string[]).includes(f.kind),
            ),
          );
      })
      .catch(() => {
        if (alive) setFiles([]);
      });
    return () => {
      alive = false;
    };
  }, [open, paymentId, reloads]);

  async function remove() {
    const file = asking;
    if (!file) return;
    setPending(true);
    try {
      await deleteStoredFile(file.id);
      toast.show(`${file.originalName} removed.`);
      setAsking(null);
      setReloads((n) => n + 1);
      onRemoved();
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : "Could not remove that.",
        "error",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Remove a screenshot"
        description={name}
      >
        {files === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading…
          </p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing attached.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 py-3">
                {file.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileHref(file.id)}
                    alt={file.originalName}
                    className="size-12 shrink-0 rounded border border-border object-cover"
                  />
                ) : null}
                <a
                  href={`${fileHref(file.id)}?inline=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-link underline decoration-link/40 underline-offset-2"
                >
                  {file.originalName}
                </a>
                <button
                  type="button"
                  onClick={() => setAsking(file)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-extrabold text-negative transition hover:bg-negative/10"
                >
                  <TrashIcon weight="duotone" size={15} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
      {asking
        ? createPortal(
            <ConfirmDialog
              open={Boolean(asking)}
              title="Remove this screenshot?"
              body={
                <>
                  <strong>{asking?.originalName}</strong> comes off {name}
                  &apos;s payment. The payment itself is not touched.
                </>
              }
              confirmLabel="Remove"
              destructive
              pending={pending}
              onConfirm={() => void remove()}
              onCancel={() => setAsking(null)}
            />,
            /* Over the drawer, not inside the row it was opened from. */
            document.body,
          )
        : null}
    </>
  );
}
