"use client";

import { formatMoney, hasCharge, todayInDhaka } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { DateInput, Field, Input, MoneyInput } from "@/components/ui/field";
import { ApiError, subscriptionsApi } from "@/lib/api-client";
import type { SubscriptionDto } from "@/lib/subscriptions";

/**
 * Upgrading a plan in place.
 *
 * The owner: *"upgrade plan name ekta option diba and oitar details o add
 * korar option rakhba jate kono existing plan ke upgrade korte pare"*. An
 * upgrade used to be a second plan added beside the first — Claude Max 5x and
 * Max 20x sat side by side on the register, a note on one saying it replaced
 * the other. Here the plan itself takes its new name and price from the day
 * given, and keeps what it was before as history.
 *
 * What the vendor charged for the upgrade on the day — a pro-rated difference,
 * usually — is optional. Given, it is taken from the plan's card like a
 * renewal is, but marked as the upgrade's, so it does not use up the month's
 * one renewal. Left empty, only the plan changes and the new price is charged
 * at the next renewal.
 */
export function UpgradeDialog({
  plan,
  onClose,
  onUpgraded,
}: {
  plan: SubscriptionDto | null;
  onClose: () => void;
  onUpgraded: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /* The charge for the upgrade: dollars, then the taka they come to at the
     rate — the renewal drawer's block, and its rule: the taka follows the two
     until somebody types in it. */
  const [chargedUsd, setChargedUsd] = useState("");
  const [usdRate, setUsdRate] = useState(plan?.usdRate ?? "");
  const [typedBdt, setTypedBdt] = useState("");
  const [bdtTouched, setBdtTouched] = useState(false);

  if (!plan) return null;

  const derivedBdt = (() => {
    const usd = Number(plain(chargedUsd));
    const rate = Number(plain(usdRate));
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
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    try {
      await subscriptionsApi.upgrade(plan.id, {
        upgradedOn: text("upgradedOn"),
        toPlanName: text("toPlanName"),
        toCostUsd: plain(text("toCostUsd")),
        toChargeUsd: plain(text("toChargeUsd")) || undefined,
        usdRate: plain(usdRate),
        chargedUsd: plain(chargedUsd) || undefined,
        chargedBdt:
          plain(chargedUsd) && bdtTouched ? plain(typedBdt) || undefined : undefined,
        bankCharge: plain(text("bankCharge")) || undefined,
        nextRenewalOn: text("nextRenewalOn") || undefined,
        note: text("note") || null,
      });
      await onUpgraded();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("That did not go through.");
      }
    } finally {
      setPending(false);
    }
  }

  const usd = (value: string | null) =>
    value ? formatMoney(value, { currency: "USD" }) : "N/A";

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Upgrade — ${plan.toolName}`}
      description="The plan takes its new name and price from the day you give, and keeps what it was as history."
    >
      <form id="upgrade-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="sv-note-violet rounded-[11px] bg-(--sv-violet-tint) px-3.5 py-2.5 text-[13.5px]">
          <span className="text-(--sv-muted)">Now: </span>
          <span className="font-extrabold">{plan.planName}</span>
          <span className="text-(--sv-muted)">
            {" "}
            · {usd(plan.costUsd)}
            {hasCharge(plan) ? ` + ${usd(plan.chargeUsd)} charge` : ""}
          </span>
        </p>

        <Field
          label="Upgraded on"
          required
          error={fieldErrors.upgradedOn}
          hint="The day the new plan started"
        >
          <DateInput name="upgradedOn" required defaultValue={todayInDhaka()} />
        </Field>

        <Field label="New plan" required error={fieldErrors.toPlanName}>
          <Input
            name="toPlanName"
            required
            maxLength={160}
            placeholder="Max Plan 20x"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="New price (USD)"
            required
            error={fieldErrors.toCostUsd}
            hint="What the new plan costs each cycle"
          >
            <MoneyInput name="toCostUsd" required placeholder="0.00" />
          </Field>
          <Field
            label="Charge (USD)"
            error={fieldErrors.toChargeUsd}
            hint="What the card adds on top each cycle. Empty for none."
          >
            <MoneyInput
              name="toChargeUsd"
              placeholder="0.00"
              defaultValue={plan.chargeUsd ?? ""}
            />
          </Field>
        </div>

        <Field
          label="USD rate"
          required
          error={fieldErrors.usdRate}
          hint="The rate the new price, and any charge today, is read at"
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

        {/*
          What the vendor took for the upgrade on the day, if anything. Empty
          means the new price starts at the next renewal and nothing leaves
          the card now.
        */}
        <fieldset className="sv-card-note flex flex-col gap-4 pt-4">
          <legend className="text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
            Charged for the upgrade today
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Amount (USD)"
              error={fieldErrors.chargedUsd}
              hint="Leave empty if nothing was charged today"
            >
              <MoneyInput
                name="chargedUsd"
                placeholder="0.00"
                value={chargedUsd}
                onChange={(event) => setChargedUsd(event.target.value)}
              />
            </Field>
            <Field
              label="Amount (BDT)"
              error={fieldErrors.chargedBdt}
              hint="Worked out from the dollars and the rate. Change it to what the bank took."
            >
              <MoneyInput
                name="chargedBdt"
                placeholder="0.00"
                value={shownBdt}
                disabled={!plain(chargedUsd)}
                onChange={(event) => {
                  setBdtTouched(true);
                  setTypedBdt(event.target.value);
                }}
              />
            </Field>
          </div>
          <Field
            label="Bank charge (BDT)"
            error={fieldErrors.bankCharge}
            hint="Its own entry under Bank charges. Leave it empty when there was none."
          >
            <MoneyInput
              name="bankCharge"
              placeholder="0.00"
              disabled={!plain(chargedUsd)}
            />
          </Field>
        </fieldset>

        <Field
          label="Next renewal"
          error={fieldErrors.nextRenewalOn}
          hint="Change it only if the vendor moved the billing date"
        >
          <DateInput
            name="nextRenewalOn"
            defaultValue={plan.nextRenewalOn ?? ""}
          />
        </Field>

        <Field label="Note" error={fieldErrors.note}>
          <Input
            name="note"
            maxLength={200}
            placeholder="More usage for the design team"
          />
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
          form="upgrade-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Upgrade
        </Button>
      </div>
    </Drawer>
  );
}

/** A money box's text, without the separators and symbols people type. */
function plain(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}
