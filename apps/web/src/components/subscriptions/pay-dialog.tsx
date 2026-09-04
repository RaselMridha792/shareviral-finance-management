"use client";

import { hasCharge, payableBdt, payableUsd } from "@finance/shared";
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

  /*
   * The three money boxes, in the order the money is actually known.
   *
   * The owner: *"usd bdt and usd rate sobgula field e aino. karon prottek
   * renewal a rate soman thakena."* A plan states the rate its price was
   * struck at; a renewal three months later was billed at a different one, and
   * a drawer that only offered the taka made him do that arithmetic himself.
   *
   * So: the dollars, then the rate, then the taka worked out from the two —
   * the same block Cash In uses, and for the same reason. The taka box stays
   * typeable, because the card may have taken something else entirely and the
   * ledger counts taka.
   */
  const [usdCharged, setUsdCharged] = useState("");
  const [usdRate, setUsdRate] = useState("");
  const [typedBdt, setTypedBdt] = useState("");
  /*
   * Whether the taka box has been typed in **in this sitting**.
   *
   * Until it has, the box shows the product and follows the two boxes above
   * it. Once it has, it is theirs and stops moving — the difference between
   * the two is precisely what a bank charge or a rounding at the card's end
   * looks like, and quietly overwriting it would be the drawer disagreeing
   * with the statement.
   */
  const [bdtTouched, setBdtTouched] = useState(false);

  if (!plan) return null;

  /* The taka the two boxes above come to. Empty when either is not a figure. */
  const derivedBdt = (() => {
    const usd = Number(plainAmount(usdCharged));
    const rate = Number(plainAmount(usdRate));
    if (!Number.isFinite(usd) || usd <= 0) return "";
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return (usd * rate).toFixed(2);
  })();
  const shownBdt = bdtTouched ? typedBdt : derivedBdt;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await subscriptionsApi.pay(plan.id, {
        txnDate: String(data.get("txnDate") ?? ""),
        /*
         * Sent only when there IS one. Blank still means "use the plan's
         * price", which is what the hint promises and what the server does.
         */
        amount:
          plainAmount(String(data.get("amount") ?? "")) || undefined,
        usdAmount:
          plainAmount(String(data.get("usdAmount") ?? "")) || undefined,
        /* The bank's fee, as its own row. "0.00" and blank both mean none. */
        chargeAmount:
          plainAmount(String(data.get("chargeAmount") ?? "")) || undefined,
        note: String(data.get("note") ?? "") || null,
        usdRate: plainAmount(String(data.get("usdRate") ?? "")) || undefined,
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

  const payable = payableBdt(plan);
  const payableInUsd = payableUsd(plan);

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

        {/*
          Dollars, then the rate, then the taka the two come to.

          This order is not decoration. A card renewal happens in dollars: the
          vendor bills $20, the bank picks a rate that day, and the taka is
          what falls out. Asking for the taka first made somebody do that
          multiplication in their head every month, at a rate that — as the
          owner put it — *"prottek renewal a rate soman thakena"*.

          Every box is optional and every one has the plan's own figure behind
          it, so a renewal at the usual price and the usual rate is still just
          a date and a button.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Amount (USD)"
            hint={
              payableInUsd
                ? hasCharge(plan)
                  ? `Blank uses $${payableInUsd} — $${plan.costUsd} plus a $${plan.chargeUsd} charge`
                  : `Blank uses the plan's price, $${payableInUsd}`
                : "What the card was billed, in dollars"
            }
          >
            <MoneyInput
              name="usdAmount"
              placeholder={payableInUsd ?? "0.00"}
              value={usdCharged}
              onChange={(event) => setUsdCharged(event.target.value)}
            />
          </Field>

          {/*
            Every entry states its rate — *"puro application a joto dhoroner
            transaction a hok na keno manually prottekbar rate bosate hobe"*.
            The plan's own is the placeholder rather than the value, because a
            box that arrives already filled is a box nobody re-reads, and the
            whole reason this one exists is that the rate moves between
            renewals. Leaving it alone still uses the plan's.
          */}
          <Field
            label="USD rate"
            hint={
              plan.usdRate
                ? `Blank uses the plan's rate, ${plan.usdRate}. It moves between renewals.`
                : "What one US dollar was worth the day the card was billed"
            }
          >
            <Input
              name="usdRate"
              inputMode="decimal"
              className="col-amount"
              placeholder={plan.usdRate ?? "122.77"}
              value={usdRate}
              onChange={(event) => setUsdRate(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Amount (BDT)"
          hint={
            derivedBdt
              ? "Worked out from the dollars and the rate. Change it to what the bank actually took — the ledger counts taka."
              : payable
                ? `Blank uses the plan's taka price, ${payable}`
                : "What was charged, in taka"
          }
        >
          <MoneyInput
            name="amount"
            placeholder={payable ?? "0.00"}
            value={shownBdt}
            onChange={(event) => {
              setBdtTouched(true);
              setTypedBdt(event.target.value);
            }}
          />
        </Field>

        {/*
          The bank's fee, and it is a different thing from the plan's own
          charge. The plan's `chargeUsd` is part of what the VENDOR bills and is
          already inside the price above; this is what the BANK takes on top,
          and like everywhere else in this app it becomes its own row under Bank
          charges rather than being buried in the amount.
        */}
        <Field
          label="Bank charge (BDT)"
          hint="Its own entry under Bank charges. Leave it empty when there was none."
        >
          <MoneyInput name="chargeAmount" placeholder="0.00" />
        </Field>

        {/*
          No Expense heading here.

          The owner: "akoi vabe recoed payment drawer eo ei expense heading
          option ta rakcho oitao tule diyo." Every payment recorded through this
          drawer is a subscription payment, so the heading was the same answer
          every time — being asked it on each renewal is being asked to confirm
          something the app already knows. The server resolves it.
        */}
        {/*
          Every entry states its rate — *"puro application a joto dhoroner
          transaction a hok na keno manually prottekbar rate bosate hobe"*.

          Pre-filled here, unlike the transaction form, because a plan already
          states the rate its dollar price was struck at, and that IS the rate
          this payment happened at unless the card was billed on a different
          day. Editable, so a day that moved can be said so.
        */}
        <Field
          label="USD rate"
          required
          hint={
            plan.usdRate
              ? "The plan's rate. Change it if the card was billed at another."
              : "What one US dollar was worth on the day the card was billed."
          }
        >
          <Input
            name="usdRate"
            required
            inputMode="decimal"
            className="col-amount"
            placeholder="122.77"
            defaultValue={plan.usdRate ?? ""}
          />
        </Field>

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

/** A money box's text, without the separators and symbols people type. */
function plainAmount(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}
