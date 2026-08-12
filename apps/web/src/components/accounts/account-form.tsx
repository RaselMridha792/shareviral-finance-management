"use client";

import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { accountsApi, type AccountDto } from "@/lib/masters";

export function AccountForm({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean;
  account?: AccountDto;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const editing = Boolean(account);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") ?? ""),
      type: String(data.get("type") ?? "bank"),
      bankName: String(data.get("bankName") ?? ""),
      branch: String(data.get("branch") ?? ""),
      accountNumber: String(data.get("accountNumber") ?? ""),
      routingNumber: String(data.get("routingNumber") ?? ""),
      currency: String(data.get("currency") ?? "BDT"),
      openingBalance: String(data.get("openingBalance") ?? "0"),
      openingBalanceOn: String(data.get("openingBalanceOn") ?? ""),
      notes: String(data.get("notes") ?? ""),
      sortOrder: Number(data.get("sortOrder") ?? 0),
    } as Parameters<typeof accountsApi.create>[0];

    try {
      if (account) {
        await accountsApi.update(account.id, payload);
      } else {
        await accountsApi.create(payload);
      }
      await onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save. Check the API is running.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? "Edit account" : "Add an account"}
      description={
        editing
          ? "Changing the opening balance moves every figure that follows it."
          : "Enter the balance this account held on the day your records start."
      }
    >
      <form
        id="account-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Name" required error={fieldErrors.name}>
          <Input
            name="name"
            defaultValue={account?.name}
            required
            autoFocus
            placeholder="DBBL Current"
          />
        </Field>

        <Field label="Type" required>
          <Select name="type" defaultValue={account?.type ?? "bank"}>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACCOUNT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank" error={fieldErrors.bankName}>
            <Input name="bankName" defaultValue={account?.bankName ?? ""} />
          </Field>
          <Field label="Branch" error={fieldErrors.branch}>
            <Input name="branch" defaultValue={account?.branch ?? ""} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Account number" error={fieldErrors.accountNumber}>
            <Input
              name="accountNumber"
              className="num"
              defaultValue={account?.accountNumber ?? ""}
            />
          </Field>
          <Field label="Routing number" error={fieldErrors.routingNumber}>
            <Input
              name="routingNumber"
              className="num"
              defaultValue={account?.routingNumber ?? ""}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Opening balance"
            required
            error={fieldErrors.openingBalance}
            hint="What this account held on the date below"
          >
            <MoneyInput
              name="openingBalance"
              defaultValue={account?.openingBalance ?? "0"}
              required
            />
          </Field>
          <Field
            label="As at"
            required
            error={fieldErrors.openingBalanceOn}
            hint="Your records start the next day"
          >
            <DateInput
              name="openingBalanceOn"
              defaultValue={account?.openingBalanceOn}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Currency" error={fieldErrors.currency}>
            <Select name="currency" defaultValue={account?.currency ?? "BDT"}>
              <option value="BDT">BDT — Taka</option>
              <option value="USD">USD — Dollar</option>
            </Select>
          </Field>
          <Field label="Order" hint="Lower shows first">
            <Input
              name="sortOrder"
              type="number"
              min={0}
              max={999}
              className="num"
              defaultValue={account?.sortOrder ?? 0}
            />
          </Field>
        </div>

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" defaultValue={account?.notes ?? ""} />
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
          form="account-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Add account"}
        </Button>
      </div>
    </Drawer>
  );
}
