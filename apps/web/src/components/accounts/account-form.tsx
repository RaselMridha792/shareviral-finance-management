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
  /*
   * The one controlled field in an otherwise uncontrolled form.
   *
   * The drawer's shape depends on it — a card has a holder and a number and no
   * branch or SWIFT — so it cannot be read only at submit. Everything else
   * stays uncontrolled and keeps its defaultValue.
   */
  const [type, setType] = useState(account?.type ?? "bank");
  const isCard = type === "card";
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
      swiftCode: String(data.get("swiftCode") ?? "").toUpperCase(),
      currency: String(data.get("currency") ?? "BDT"),
      openingBalance: String(data.get("openingBalance") ?? "0"),
      openingBalanceOn: String(data.get("openingBalanceOn") ?? ""),
      notes: String(data.get("notes") ?? ""),
      sortOrder: Number(data.get("sortOrder") ?? 0),
      /*
       * Only for a card. On anything else these are not rendered, and sending
       * "" would CLEAR what a card holds — blank clears, by the union in the
       * schema — so an account switched to bank and back would lose its number.
       */
      ...(isCard
        ? {
            cardHolderName: String(data.get("cardHolderName") ?? ""),
            cardLabel: String(data.get("cardLabel") ?? ""),
            cardNumber: String(data.get("cardNumber") ?? ""),
            cardExpiry: String(data.get("cardExpiry") ?? ""),
            cardCvc: String(data.get("cardCvc") ?? ""),
          }
        : {}),
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
          <Select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ACCOUNT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        {/*
          The bank's name doubles as the card company's — one column, two
          readings — so it stays for both and only the label changes. Branch,
          account number, routing and SWIFT are hidden for a card, which has
          none of them; a row of empty boxes reads as missing data.

          HIDING DOES NOT CLEAR. Anything stored on an account switched to card
          stays in its column, because a field that is not rendered sends
          nothing and the patch leaves absent keys alone. Switching a type by
          mistake must not destroy the bank details.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={isCard ? "Card company" : "Bank"}
            error={fieldErrors.bankName}
          >
            <Input
              name="bankName"
              defaultValue={account?.bankName ?? ""}
              placeholder={isCard ? "Payoneer" : undefined}
            />
          </Field>
          {isCard ? (
            <Field label="Card holder" error={fieldErrors.cardHolderName}>
              <Input
                name="cardHolderName"
                defaultValue={account?.cardHolderName ?? ""}
                placeholder="The name embossed on it"
              />
            </Field>
          ) : (
            <Field label="Branch" error={fieldErrors.branch}>
              <Input name="branch" defaultValue={account?.branch ?? ""} />
            </Field>
          )}
        </div>

        {isCard ? (
          <>
            <Field
              label="Card name"
              error={fieldErrors.cardLabel}
              hint="What you call it, so one card is told apart from another"
            >
              <Input
                name="cardLabel"
                defaultValue={account?.cardLabel ?? ""}
                placeholder="Platinum Business"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Card number"
                error={fieldErrors.cardNumber}
                hint={
                  account?.cardLast4
                    ? "On file. Leave blank to keep the stored one."
                    : "Encrypted. Only the last four are ever shown."
                }
              >
                <Input
                  name="cardNumber"
                  className="num"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={25}
                  placeholder={
                    account?.cardLast4
                      ? "**** **** **** " + account.cardLast4
                      : "4111 1111 1111 1111"
                  }
                />
              </Field>
              <Field label="Expires" error={fieldErrors.cardExpiry}>
                <Input
                  name="cardExpiry"
                  className="num"
                  placeholder="09/2028"
                  maxLength={7}
                  defaultValue={account?.cardExpiry ?? ""}
                />
              </Field>
              <Field
                label="CVC"
                error={fieldErrors.cardCvc}
                hint="Encrypted, and never shown without the card password"
              >
                <Input
                  name="cardCvc"
                  className="num"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  placeholder="123"
                />
              </Field>
            </div>

            {/*
              Said out loud, once, where the decision is being acted on. The
              owner chose to store these; nobody reading the drawer later should
              have to guess whether that was thought about.
            */}
            <p className="-mt-1 text-xs text-muted-foreground">
              The number and CVC are encrypted before they are stored, never
              sent to any screen, and read back only by someone who knows the
              card password.
            </p>
          </>
        ) : null}

        {isCard ? null : (
          <>
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

            <Field
              label="SWIFT / BIC"
              error={fieldErrors.swiftCode}
              hint="8 or 11 characters, like SCBLBDDX — needed for transfers from abroad"
            >
              <Input
                name="swiftCode"
                className="num uppercase"
                maxLength={11}
                placeholder="SCBLBDDX"
                defaultValue={account?.swiftCode ?? ""}
              />
            </Field>
          </>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Opening balance"
            required
            error={fieldErrors.openingBalance}
            hint="What the account held on the day below"
          >
            <MoneyInput
              name="openingBalance"
              defaultValue={account?.openingBalance ?? "0"}
              required
            />
          </Field>
          <Field
            /*
             * "As at" is how a bank writes it and not how anybody reads it —
             * the owner's words: "eta banking related kono nam eta amra
             * bujhina". The pair now reads as one sentence: what it held, and
             * the day it held it.
             */
            label="Opening balance date"
            required
            error={fieldErrors.openingBalanceOn}
            hint="Entries you record start from the next day"
          >
            <DateInput
              name="openingBalanceOn"
              defaultValue={account?.openingBalanceOn}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Primary currency"
            error={fieldErrors.currency}
            hint="USD makes this account's forms ask for dollars first, converted at the day's rate. Every report still counts taka."
          >
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
