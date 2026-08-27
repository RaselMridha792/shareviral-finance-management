"use client";

import {
  ALLOWED_MIME_TYPES,
  formatFileSize,
  MAX_FILE_BYTES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { ArrowRight, LoaderCircle, Paperclip, X } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
} from "@/components/ui/field";
import { formatMoney } from "@finance/shared";

import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import { ledgerApi } from "@/lib/ledger";
import type { AccountWithBalance } from "@/lib/masters";

/**
 * Moving money between our own accounts. Creates two linked rows — one out,
 * one in — so each account's register matches its own bank statement.
 */
export function TransferForm({
  open,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
  /**
   * With balances, because the account rule refuses a transfer past what the
   * account holds — the picker saying "৳48,750.00" beside the name is the
   * warning that arrives before the refusal has to.
   */
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  /*
   * The paper, held until the pair exists to hang it on — the same two slots
   * every money form carries: the invoice (ours) and the bank's record.
   */
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [bankFile, setBankFile] = useState<File | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      const row = await ledgerApi.transfer({
        txnDate: String(data.get("txnDate")),
        fromAccountId: String(data.get("fromAccountId")),
        toAccountId: String(data.get("toAccountId")),
        amount: String(data.get("amount")),
        description: String(data.get("description")),
        invoiceNo: String(data.get("invoiceNo") ?? "") || undefined,
        reference: String(data.get("reference") ?? "") || undefined,
        paymentMethod: String(data.get("paymentMethod")) as never,
      });

      /*
       * Uploaded one at a time and never thrown: by now the money has moved,
       * and a failed upload must read as "attach it again", not as the
       * transfer having failed.
       */
      const failed: string[] = [];
      for (const slot of [
        { kind: "invoice", file: invoiceFile, name: "invoice" },
        { kind: "bank_statement", file: bankFile, name: "bank record" },
      ]) {
        if (!slot.file) continue;
        try {
          await uploadTransactionFile(row.id, slot.file, slot.kind);
        } catch {
          failed.push(slot.name);
        }
      }

      await onSaved();
      if (failed.length) {
        setInvoiceFile(null);
        setBankFile(null);
        setError(
          `The transfer is recorded, but the ${failed.join(" and the ")} did not upload — open it from the table's number and attach again.`,
        );
        setPending(false);
        return;
      }
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save.");
      }
    } finally {
      setPending(false);
    }
  }

  if (accounts.length < 2) {
    return (
      <Drawer open={open} onClose={onClose} title="Move money between accounts">
        <p className="text-sm text-muted-foreground">
          You need at least two accounts before money can be moved between them.
          Add another in Accounts.
        </p>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Move money between accounts"
      description="Records two entries so each account matches its own statement."
    >
      <form
        id="transfer-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Date" required error={fieldErrors.txnDate}>
          <DateInput name="txnDate" required defaultValue={todayInDhaka()} />
        </Field>

        <div className="flex items-end gap-2">
          <Field
            label="From"
            required
            error={fieldErrors.fromAccountId}
            className="flex-1"
          >
            <Select
              name="fromAccountId"
              required
              defaultValue={accounts[0]?.id}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} — {formatMoney(account.balance)}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="mb-3 size-4 shrink-0 text-muted-foreground" />
          <Field
            label="To"
            required
            error={fieldErrors.toAccountId}
            className="flex-1"
          >
            <Select name="toAccountId" required defaultValue={accounts[1]?.id}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} — {formatMoney(account.balance)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Amount" required error={fieldErrors.amount}>
          <MoneyInput name="amount" required placeholder="0.00" />
        </Field>

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            placeholder="Moved to petty cash"
          />
        </Field>

        {/* The pair every money form carries, each with its paper on the
            clip beside it: the invoice number is ours, the transaction id is
            the bank's. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Invoice No." error={fieldErrors.invoiceNo}>
            <Attach kind="invoice" file={invoiceFile} onPick={setInvoiceFile}>
              <Input
                name="invoiceNo"
                className="num min-w-0 flex-1"
                placeholder="INV-002"
              />
            </Attach>
          </Field>
          <Field label="Transaction ID" error={fieldErrors.reference}>
            <Attach kind="bank_statement" file={bankFile} onPick={setBankFile}>
              <Input name="reference" className="num min-w-0 flex-1" />
            </Attach>
          </Field>
        </div>

        <Field label="Method">
          <Select name="paymentMethod" defaultValue="bank_transfer">
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="transfer-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record the transfer
        </Button>
      </div>
    </Drawer>
  );
}

type DocKind = "invoice" | "bank_statement";

const DOCUMENT_NAMES: Record<DocKind, string> = {
  invoice: "invoice",
  bank_statement: "bank record",
};

/**
 * The paperclip beside a reference number — the paper is picked in the same
 * breath as the number and held until the pair exists to hang it on. The
 * same helper the transaction and cash-in forms carry; the third copy is a
 * known rough edge, tracked rather than hidden.
 */
function Attach({
  kind,
  file,
  onPick,
  children,
}: {
  kind: DocKind;
  file: File | null;
  onPick: (file: File | null) => void;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  function choose(picked: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!picked) return;

    const allowed: readonly string[] = ALLOWED_MIME_TYPES[kind];
    if (picked.type && !allowed.includes(picked.type)) {
      setRejected("Only JPEG, PNG, WebP and PDF can be stored.");
      return;
    }
    if (picked.size > MAX_FILE_BYTES[kind]) {
      setRejected(
        `That is ${formatFileSize(picked.size)}; the limit is ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
      );
      return;
    }

    setRejected(null);
    onPick(picked);
  }

  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        {children}

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept="image/*,application/pdf"
          onChange={(event) => choose(event.target.files?.[0])}
        />

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="size-9 shrink-0 px-0"
          title={`Attach the ${DOCUMENT_NAMES[kind]}`}
          aria-label={`Attach the ${DOCUMENT_NAMES[kind]}`}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
      </span>

      {rejected ? (
        <span className="text-xs text-negative">{rejected}</span>
      ) : file ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label={`Remove ${file.name}`}
            className="shrink-0 cursor-pointer rounded p-0.5 transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ) : null}
    </span>
  );
}
