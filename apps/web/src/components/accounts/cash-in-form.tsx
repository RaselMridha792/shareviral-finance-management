"use client";

import { isValidAmount, todayInDhaka } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useMoney } from "@/components/settings-provider";
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
import { ledgerApi } from "@/lib/ledger";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { fxApi } from "@/lib/reports";

/**
 * A remittance advice, typed in.
 *
 * The paper the bank sends names four things about the *sender* — its bank, the
 * account the money left, the name on that account, and often a SWIFT code —
 * plus the reference the wire travelled under and the rate the day was settled
 * at. Those are what this form asks for. Which of our own accounts it landed in
 * is chosen here too, because the advice does not decide that: it is a fact
 * about our side, and a transfer can land in any of them.
 *
 * It writes an ordinary money-in transaction. Nothing here bypasses the ledger.
 */
export function CashInForm({
  open,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  /**
   * The rate governs the whole month, so an empty box is the expensive
   * outcome. Prefilled with the last one recorded — almost always today's —
   * and editable, because the day's rate is the entire point of asking.
   */
  const [usdRate, setUsdRate] = useState("");
  const [latestRate, setLatestRate] = useState<string | null>(null);

  /**
   * Both tracked only so the realised rate can be read back while it is being
   * typed. A wrong figure is cheap to fix here and expensive to find later, in
   * a report that quietly says a dollar cost ৳1,227.
   */
  const [amount, setAmount] = useState("");
  const [usdSent, setUsdSent] = useState("");

  const money = useMoney();
  const realised = realisedRate(amount, usdSent);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void fxApi
      .rates(1)
      .then((rates) => {
        if (cancelled) return;
        const last = rates[0]?.rate ?? null;
        setLatestRate(last);
        // Never overwrite what the person has already started typing.
        setUsdRate((current) => current || (last ?? ""));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Money in can only be filed under a money-in heading.
  const usable = categories.filter(
    (group) => group.kind === "in" || group.kind === "both",
  );
  const defaultCategoryId = fundingCategoryId(usable);

  /**
   * Closing empties the two controlled boxes.
   *
   * Everything else in here is uncontrolled and the drawer unmounts its
   * children, so the form comes back blank on its own. These two would not,
   * and a reopened form pre-filled with the last transfer's figures is how the
   * same amount gets recorded twice. The rate is deliberately not cleared —
   * it is prefilled from the last one recorded anyway.
   */
  function close() {
    setAmount("");
    setUsdSent("");
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? undefined : value;
    };

    try {
      await ledgerApi.recordCashIn({
        txnDate: String(data.get("txnDate")),
        reference: text("reference"),
        description: String(data.get("description")),
        accountId: String(data.get("accountId")),
        amount: String(data.get("amount")),
        categoryId: String(data.get("categoryId")),
        usdRate: String(data.get("usdRate")).trim(),
        // Blank on a local receipt, and then this row is exactly what it was
        // before: an ordinary money-in with a reference rate on it. Given, the
        // API fills the conversion columns the funding report reads.
        usdSent: plainAmount(String(data.get("usdSent") ?? "")) || undefined,
        senderBankName: text("senderBankName"),
        senderAccountName: text("senderAccountName"),
        senderAccountNumber: text("senderAccountNumber"),
        senderSwiftCode: text("senderSwiftCode"),
        // Money from abroad arrives one way. Offering a choice here would only
        // create a row that says a wire was paid in cash.
        paymentMethod: "bank_transfer",
        notes: text("notes"),
        receiptUrl: undefined,
      });
      await onSaved();
      close();
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
      onClose={close}
      title="Record cash in"
      description="Money received from abroad, as the remittance advice states it."
    >
      <form id="cash-in-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date" required error={fieldErrors.txnDate}>
            <DateInput name="txnDate" required defaultValue={todayInDhaka()} />
          </Field>
          <Field
            label="Amount received"
            required
            error={fieldErrors.amount}
            hint="What landed, in taka"
          >
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Landed in"
          required
          error={fieldErrors.accountId}
          hint="Our account the transfer arrived in"
        >
          <Select name="accountId" required defaultValue={accounts[0]?.id}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Category" required error={fieldErrors.categoryId}>
          <Select name="categoryId" required defaultValue={defaultCategoryId}>
            <option value="" disabled>
              Choose a category
            </option>
            {usable.map((group) => (
              <optgroup key={group.id} label={group.name}>
                <option value={group.id}>{group.name} (general)</option>
                {group.children
                  .filter((child) => child.isActive)
                  .map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        <Field
          label="Transaction id"
          error={fieldErrors.reference}
          hint="The bank's reference for this transfer"
        >
          <Input name="reference" className="num" placeholder="FT26081200412" />
        </Field>

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            placeholder="August funding from ShareViral Corp"
          />
        </Field>

        {/* The sending side, kept together because it is copied off one
            document in one go. Every field optional: an advice without a
            SWIFT is still a transfer that happened, and losing the whole
            record over a line the bank did not print helps nobody. */}
        <fieldset className="grid gap-4 rounded-lg bg-surface-muted p-4">
          <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Sent from
          </legend>

          <Field label="Account number" error={fieldErrors.senderAccountNumber}>
            <Input
              name="senderAccountNumber"
              className="num"
              placeholder="0123456789"
            />
          </Field>

          <Field
            label="Account name"
            error={fieldErrors.senderAccountName}
            hint="The name the sending account is held in"
          >
            <Input name="senderAccountName" placeholder="ShareViral Corp" />
          </Field>

          <Field label="Bank name" error={fieldErrors.senderBankName}>
            <Input name="senderBankName" placeholder="Bank of America" />
          </Field>

          <Field
            label="SWIFT code"
            error={fieldErrors.senderSwiftCode}
            hint="Optional — leave it blank if the advice does not say"
          >
            <Input
              name="senderSwiftCode"
              className="num uppercase"
              placeholder="BOFAUS3N"
            />
          </Field>
        </fieldset>

        {/* The dollar side of the transfer, and the only part of this form
            nobody can reconstruct afterwards. The rate is asked here, at the
            only moment anybody knows it, because it is read back all month:
            every taka figure after it is shown in dollars at the rate the
            month's funding arrived at. A rate looked up later is the rate on
            the day of the lookup. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="USD sent"
            error={fieldErrors.usdSent}
            hint="Optional — what the sender sent, before conversion"
          >
            <MoneyInput
              name="usdSent"
              placeholder="0.00"
              value={usdSent}
              onChange={(event) => setUsdSent(event.target.value)}
            />
          </Field>

          <Field
            label="Dollar rate"
            required
            error={fieldErrors.usdRate}
            hint={
              latestRate
                ? `Last recorded: ৳${latestRate}. It governs the whole month.`
                : "What a dollar was worth on the day. It governs the whole month."
            }
          >
            <Input
              name="usdRate"
              required
              inputMode="decimal"
              className="col-amount"
              placeholder="122.77"
              value={usdRate}
              onChange={(event) => setUsdRate(event.target.value)}
            />
          </Field>
        </div>

        {/* The arithmetic, back in front of the person who typed it. A digit
            too many in either box turns a plausible rate into an absurd one,
            and that is obvious here and nearly invisible in a report next
            quarter. This is also the figure the funding report will show for
            this transfer — it divides the same two numbers. */}
        {realised ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            <span className="num">
              {money(realised.bdt, { hideDecimals: true })} ÷{" "}
              {money(realised.usd, { currency: "USD", hideDecimals: true })} ={" "}
              <strong className="font-semibold text-foreground">
                {money(realised.rate)}
              </strong>
            </span>{" "}
            per USD — the rate this transfer actually achieved.
          </p>
        ) : usdSent.trim() ? (
          <p className="text-xs text-muted-foreground">
            Fill in both the amount received and the dollars sent to see the
            rate this transfer achieved.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Leave <span className="font-medium">USD sent</span> blank for a
            local receipt. Filled in, this transfer appears in the funding
            report with the rate it achieved.
          </p>
        )}

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" />
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
          form="cash-in-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Record it
        </Button>
      </div>
    </Drawer>
  );
}

/**
 * Strips what a person types out of habit. "1,00,000" and "৳1,00,000" are the
 * same figure to a reader and neither is one to `numeric(14,2)`.
 */
function plainAmount(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}

/**
 * What a transfer actually achieved: what landed, over what was sent.
 *
 * Null until both figures are there and usable, so a half-typed amount shows
 * nothing rather than a rate that lurches through several alarming values on
 * the way to the right one.
 *
 * Deliberately the same division the funding report does — that report divides
 * the stored taka by the stored dollars rather than trusting a recorded rate,
 * so this preview is the number that will appear there, not an approximation
 * of it.
 */
function realisedRate(
  amountBdt: string,
  usdSent: string,
): { bdt: string; usd: string; rate: string } | null {
  const bdt = plainAmount(amountBdt);
  const usd = plainAmount(usdSent);

  if (!isValidAmount(bdt) || !isValidAmount(usd)) return null;
  if (Number(bdt) <= 0 || Number(usd) <= 0) return null;

  return { bdt, usd, rate: (Number(bdt) / Number(usd)).toFixed(2) };
}

/**
 * Where a transfer from the parent company belongs, if the heading exists.
 *
 * A guess at the common case, not a rule — the select is right there. Falls
 * back to the first money-in category so the field is never blank, since a
 * blank required select is a failed save waiting to happen.
 */
function fundingCategoryId(groups: CategoryNode[]): string {
  for (const group of groups) {
    const funding = group.children.find(
      (child) => child.isActive && /funding/i.test(child.name),
    );
    if (funding) return funding.id;
  }
  const first = groups[0];
  if (!first) return "";
  return first.children.find((child) => child.isActive)?.id ?? first.id;
}
