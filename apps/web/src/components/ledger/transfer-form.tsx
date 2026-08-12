"use client";

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { ledgerApi } from "@/lib/ledger";
import type { AccountDto } from "@/lib/masters";

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
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await ledgerApi.transfer({
        txnDate: String(data.get("txnDate")),
        fromAccountId: String(data.get("fromAccountId")),
        toAccountId: String(data.get("toAccountId")),
        amount: String(data.get("amount")),
        description: String(data.get("description")),
        reference: String(data.get("reference") ?? "") || undefined,
        paymentMethod: String(data.get("paymentMethod")) as never,
      });
      await onSaved();
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
      <form id="transfer-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Date" required error={fieldErrors.txnDate}>
          <DateInput name="txnDate" required defaultValue={todayInDhaka()} />
        </Field>

        <div className="flex items-end gap-2">
          <Field label="From" required error={fieldErrors.fromAccountId} className="flex-1">
            <Select name="fromAccountId" required defaultValue={accounts[0]?.id}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="mb-3 size-4 shrink-0 text-muted-foreground" />
          <Field label="To" required error={fieldErrors.toAccountId} className="flex-1">
            <Select name="toAccountId" required defaultValue={accounts[1]?.id}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Method">
            <Select name="paymentMethod" defaultValue="bank_transfer">
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" error={fieldErrors.reference}>
            <Input name="reference" className="num" />
          </Field>
        </div>

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
