"use client";

import { convertAmount, formatMoney, isValidAmount } from "@finance/shared";
import { useState } from "react";

import { Field, MoneyInput } from "@/components/ui/field";

export type ChargeCurrency = "USD" | "BDT";

/**
 * The bank charge box, in the entry's own currency.
 *
 * The owner, 28 Sep 2026: *"dhoro ami transaction ta korechi usd te kintu bank
 * charge keno ami bdt te likhbo. jokhon bdt transaction hobe tokhon bank
 * charge o bdt hobe r jokhon usd hobe tokhon bank charge o usd howa ucit"*.
 * So on a dollar entry this asks for dollars — "Bank charge (USD)" — and the
 * taka it comes to at the entry's rate is read back under it; on a taka entry
 * it is the "Bank charge (BDT)" box it always was.
 *
 * Which currency is the calling form's decision (each already knows whether it
 * is dollars-first); this only draws it. The input's NAME is what carries the
 * currency to the server — `chargeAmount` in taka, `chargeUsd` in dollars
 * (`bankCharge` / `bankChargeUsd` on the upgrade drawer) — so a form reads
 * whichever of the two its FormData holds, and there is only ever one.
 *
 * The taka shown here is a preview. The server works out the figure it stores,
 * at the entry's own rate, in paisa — this uses the same helper so the two
 * cannot disagree.
 *
 * Used by the five forms that take a charge: an entry (transaction-form), Cash
 * In, Money Transfer, a plan's Renew and its Upgrade.
 */
export function BankChargeField({
  currency,
  entryCurrency,
  onUseEntryCurrency,
  names = { bdt: "chargeAmount", usd: "chargeUsd" },
  defaultValue,
  rate,
  error,
  disabled,
}: {
  /** What the box asks for. */
  currency: ChargeCurrency;
  /**
   * What the entry's own rule says. Different from `currency` only when a
   * correction opened a charge that was entered the other way — an old taka
   * charge on a dollar entry — and then the box offers to switch.
   */
  entryCurrency?: ChargeCurrency;
  onUseEntryCurrency?: () => void;
  names?: { bdt: string; usd: string };
  defaultValue?: string | null;
  /** The entry's rate as typed, for reading the dollars back in taka. */
  rate?: string;
  error?: string[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  /*
   * A currency switch empties the box, during the render that notices it — a
   * ৳200 typed on a taka account must not become $200 when the account picked
   * turns out to be a dollar one.
   */
  const [shownIn, setShownIn] = useState(currency);
  if (shownIn !== currency) {
    setShownIn(currency);
    setValue("");
  }

  const taka = currency === "USD" ? takaFor(value, rate) : null;
  const other =
    entryCurrency && entryCurrency !== currency ? entryCurrency : null;

  const hint =
    currency === "USD" ? (
      taka ? (
        <>
          {formatMoney(taka)} at this entry&apos;s rate. Its own entry under
          Bank charges.
        </>
      ) : (
        "In dollars, like the entry. Its own entry under Bank charges, in taka at this entry's rate."
      )
    ) : (
      "Its own entry under Bank charges. Leave it empty when there was none."
    );

  return (
    <Field
      label={`Bank charge (${currency})`}
      error={error}
      hint={
        other && onUseEntryCurrency ? (
          <>
            {currency === "BDT" ? "Entered in taka. " : "Entered in dollars. "}
            <button
              type="button"
              data-charge-switch
              onClick={(event) => {
                event.preventDefault();
                onUseEntryCurrency();
              }}
              className="cursor-pointer font-extrabold text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              Enter it in {other === "USD" ? "dollars" : "taka"} instead
            </button>
          </>
        ) : (
          hint
        )
      }
    >
      <MoneyInput
        name={currency === "USD" ? names.usd : names.bdt}
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
      />
    </Field>
  );
}

/**
 * The taka a dollar charge comes to at the rate beside it — the same helper
 * the server stores with, so the preview is the figure. Null until both are
 * usable figures.
 */
function takaFor(usd: string, rate: string | undefined): string | null {
  const dollars = usd.replace(/[,\s$]/g, "").trim();
  const at = (rate ?? "").replace(/[,\s৳]/g, "").trim();
  if (!isValidAmount(dollars) || Number(dollars) <= 0) return null;
  if (!/^\d{1,5}(\.\d{1,6})?$/.test(at) || Number(at) <= 0) return null;
  try {
    return convertAmount(dollars, at);
  } catch {
    return null;
  }
}
