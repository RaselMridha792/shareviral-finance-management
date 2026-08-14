"use client";

import { todayInDhaka } from "@finance/shared";
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
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { ledgerApi } from "@/lib/ledger";
import type { AccountDto, CategoryNode, VendorDto } from "@/lib/masters";

/**
 * Records that a tool was paid for this month.
 *
 * These are bought month by month — some months yes, some months no — so there
 * is no renewal to tick off and no schedule to run. Somebody says "we paid for
 * Claude this month" and this writes the ordinary money-out row that says so.
 *
 * It exists because the link had nowhere else to come from. Spend per tool is
 * grouped by `vendor_id`, and the only field that ever set one was the free-text
 * "Paid to" box on the entry form — which was removed, because typing a name
 * there created master data as a side effect and is how a supplier called
 * "150000.00" came to exist. Removing it left the subscriptions screen unable to
 * ever show a tool as paid. This puts the link back deliberately: an existing
 * tool, chosen by id, never invented from what somebody typed.
 */
export function SubscriptionPaymentForm({
  vendor,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  vendor: VendorDto | null;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Only what money can actually leave from, and only headings money can go out
  // under — a payment filed against an income category is a payment nobody can
  // find again.
  const usable = accounts.filter((account) => account.isActive);
  const outCategories = categories.filter((node) => node.kind !== "in");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vendor) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? undefined : value;
    };

    try {
      await ledgerApi.create({
        direction: "out",
        txnDate: String(data.get("txnDate")),
        accountId: String(data.get("accountId")),
        amount: String(data.get("amount")),
        categoryId: String(data.get("categoryId")),
        // The whole point of this form: the payment is tied to the tool, by id.
        vendorId: vendor.id,
        description: String(data.get("description")),
        paymentMethod: "card",
        reference: text("reference"),
        notes: text("notes"),
      } as never);
      await onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not record that.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={Boolean(vendor)}
      onClose={onClose}
      title="Record payment"
      description={
        vendor
          ? `${vendor.name} — this writes an ordinary money-out entry, tied to this tool.`
          : ""
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date" required error={fieldErrors.txnDate}>
            <DateInput name="txnDate" required defaultValue={todayInDhaka()} />
          </Field>
          <Field
            label="Amount"
            required
            error={fieldErrors.amount}
            hint="What actually left, in taka"
          >
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              // The usual cost, as a starting point — it is editable because a
              // month's bill is not always the usual one.
              defaultValue={vendor?.billingAmount ?? ""}
            />
          </Field>
        </div>

        <Field label="Paid from" required error={fieldErrors.accountId}>
          <Select name="accountId" required>
            {usable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Category" required error={fieldErrors.categoryId}>
          <Select name="categoryId" required>
            {outCategories.flatMap((parent) =>
              parent.children.length
                ? parent.children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {parent.name} › {child.name}
                    </option>
                  ))
                : [
                    <option key={parent.id} value={parent.id}>
                      {parent.name}
                    </option>,
                  ],
            )}
          </Select>
        </Field>

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            defaultValue={vendor ? `${vendor.name} — subscription` : ""}
          />
        </Field>

        <Field
          label="Reference"
          error={fieldErrors.reference}
          hint="Card or invoice reference, if there is one"
        >
          <Input name="reference" />
        </Field>

        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Record payment
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
