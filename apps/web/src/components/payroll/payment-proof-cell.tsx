"use client";

import { ALLOWED_MIME_TYPES } from "@finance/shared";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { LoaderCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { DocumentsDialog } from "@/components/ledger/documents-dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import type { PayrollLineDto } from "@/lib/payroll";

/** The kinds a payment's Reference counts, as All transactions counts them. */
const REFERENCE_KINDS = ["bank_statement", "receipt", "other"] as const;

/**
 * The salary sheet's Reference cell: proof this person was paid.
 *
 * The owner, 27 Oct 2026: a Reference column where the screenshot of each
 * person's transfer is uploaded. It hangs on the line's PAYMENT row, as that
 * entry's bank record — so the same screenshot is its Reference on All
 * transactions too, and nothing new is invented to hold it.
 *
 * A line not yet paid has no payment to prove, and says so.
 */
export function PaymentProofCell({
  line,
  onChanged,
}: {
  line: PayrollLineDto;
  onChanged: () => void;
}) {
  const canUpload = useCan("transactions.write");
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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
      <td className="text-xs text-muted-foreground" title="Pay the sheet first">
        N/A
      </td>
    );
  }

  return (
    <td>
      <div className="flex items-center gap-3 whitespace-nowrap">
        {count > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-extrabold text-link"
          >
            <EyeIcon weight="duotone" size={15} />
            View{count > 1 ? ` (${count})` : ""}
          </button>
        ) : canUpload ? null : (
          <span className="text-xs text-muted-foreground">N/A</span>
        )}
        {canUpload ? (
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
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              {count > 0 ? "Add" : "Upload"}
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <DocumentsDialog
          transactionId={paymentId}
          refNo={line.fullName}
          kinds={REFERENCE_KINDS}
          title="Reference"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </td>
  );
}
