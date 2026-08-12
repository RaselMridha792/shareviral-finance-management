"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Field, Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";

/**
 * Voiding needs a reason. The row stays — struck through and out of every
 * total — because a deleted entry cannot answer the question someone asks
 * about it six months later.
 */
export function VoidDialog({
  transaction,
  onClose,
  onVoided,
}: {
  transaction: TransactionDto | null;
  onClose: () => void;
  onVoided: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transaction) return;
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await ledgerApi.void(transaction.id, {
        reason: String(data.get("reason") ?? ""),
      });
      await onVoided();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not void that.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={`Void ${transaction.refNo}`}>
      <div className="mb-5 rounded-lg border border-border bg-surface-muted p-4">
        <p className="text-sm font-medium">{transaction.description}</p>
        <p className="num mt-1 text-xs text-muted-foreground">
          {transaction.txnDate} · {transaction.accountName}
        </p>
        <Amount
          value={transaction.signedAmount}
          showSign
          currency={transaction.currency}
          tone={transaction.direction === "in" ? "in" : "out"}
          className="mt-2 block text-lg font-semibold"
        />
      </div>

      <div className="mb-5 flex items-start gap-3 rounded-lg bg-warning/10 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-sm text-muted-foreground">
          The entry stays visible with a line through it and drops out of every
          total.{" "}
          {transaction.transferGroupId
            ? "Its matching transfer row is voided too — one movement recorded twice cannot be half-undone."
            : "It cannot be edited afterwards."}
        </p>
      </div>

      <form id="void-form" onSubmit={onSubmit}>
        <Field label="Why" required>
          <Textarea
            name="reason"
            required
            minLength={3}
            autoFocus
            placeholder="Duplicate of the earlier bill"
          />
        </Field>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
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
          form="void-form"
          variant="primary"
          disabled={pending}
          className="bg-negative"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Void it
        </Button>
      </div>
    </Drawer>
  );
}
