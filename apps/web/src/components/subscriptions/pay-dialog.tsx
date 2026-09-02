"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Input, MoneyInput } from "@/components/ui/field";
import { ApiError, subscriptionsApi } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { SubscriptionDto } from "@/lib/subscriptions";

/**
 * Recording that a plan was actually paid for.
 *
 * The owner's report, and it was right: *"ekhane kichu kinle eta taka katena
 * bank theke kono history thakena"*. A subscription was a PLAN — price, card,
 * renewal date — and nothing about it ever moved money. This is the act that
 * does, and it writes an ordinary expense: the card gets poorer, the entry
 * appears on the Expenses screens, and every rule that guards money applies to
 * it because it goes through the same door a typed expense does.
 *
 * Three things are asked for and all three are pre-filled, because the plan
 * already knows them. The date is the only one somebody usually changes.
 *
 * **Nothing here happens on a schedule.** A payment is recorded when somebody
 * says it happened, on the day they say — an app that wrote expenses by itself
 * would put figures in the books nobody typed, and the first time a card was
 * declined it would disagree with the bank with no way to tell which was right.
 */
export function PayDialog({
  plan,
  onClose,
  onPaid,
}: {
  plan: SubscriptionDto | null;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!plan) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await subscriptionsApi.pay(plan.id, {
        txnDate: String(data.get("txnDate") ?? ""),
        amount: String(data.get("amount") ?? "") || undefined,
        note: String(data.get("note") ?? "") || null,
        advanceRenewal: data.get("advanceRenewal") === "on",
      });
      await onPaid();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "That did not go through.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Record a payment — ${plan.toolName}`}
      description="This writes a real expense against the card. The balance moves."
    >
      <form id="pay-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label="Date it was charged"
          required
          hint="The day the card was actually debited, not today by default"
        >
          <DateInput name="txnDate" required />
        </Field>

        <Field
          label="Amount"
          hint={
            plan.costBdt
              ? `Blank uses the plan's price, ${plan.costBdt}`
              : "What was charged, in taka"
          }
        >
          <MoneyInput name="amount" placeholder={plan.costBdt ?? "0.00"} />
        </Field>

        {/*
          No Expense heading here.

          The owner: "akoi vabe recoed payment drawer eo ei expense heading
          option ta rakcho oitao tule diyo." Every payment recorded through this
          drawer is a subscription payment, so the heading was the same answer
          every time — being asked it on each renewal is being asked to confirm
          something the app already knows. The server resolves it.
        */}
        <Field
          label="Note"
          hint="Anything that makes this charge recognisable later"
        >
          <Input name="note" maxLength={200} placeholder="March renewal" />
        </Field>

        {/*
          Off by default, and that is deliberate. A payment is not always the
          month's renewal — somebody may be recording one they forgot in March —
          and moving the renewal date on a back-dated entry would tell the
          reminder it has a month it does not.
        */}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="advanceRenewal"
            className="mt-0.5 size-3.5 cursor-pointer accent-primary"
          />
          <span>
            Move the renewal on a cycle
            {plan.nextRenewalOn ? (
              <span className="block text-xs text-muted-foreground">
                Currently {formatDate(plan.nextRenewalOn)}
              </span>
            ) : null}
          </span>
        </label>

        {error ? <p className="text-sm text-negative">{error}</p> : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="pay-form"
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
