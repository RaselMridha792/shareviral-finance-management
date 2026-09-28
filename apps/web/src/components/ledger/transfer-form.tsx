"use client";

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AttachClip, useStoredPapers } from "@/components/files/attach-clip";
import {
  BankChargeField,
  type ChargeCurrency,
} from "@/components/ledger/bank-charge-field";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
} from "@/components/ui/field";
import { formatMoney } from "@finance/shared";

import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import { ledgerApi, type TransferRowDto } from "@/lib/ledger";
import type { AccountWithBalance } from "@/lib/masters";

/**
 * Moving money between our own accounts. Creates two linked rows — one out,
 * one in — so each account's register matches its own bank statement.
 *
 * Handed a `transfer`, it corrects that one instead: both halves and the bank
 * charge change together through `updateTransfer`, the accounts stay as they
 * are, and the files already on it are listed on the clips.
 */
/**
 * How an account reads in the picker: in its own currency.
 *
 * It read `Exprovia LLC — ৳17,11,220.00` for a dollar account, which is the
 * ledger's figure rather than the account's. `ownBalance` is what that account
 * actually holds in the currency it is kept in — dollars added up, not taka
 * divided — so no rate is needed here at all, and the number cannot drift when
 * one moves.
 *
 * `~` only when the account itself says the figure is approximate, which
 * happens when some row on it carried neither its dollars nor a rate. An
 * option cannot hold markup, so the mark is the character.
 */
function optionLabel(account: AccountWithBalance): string {
  if (account.currency === "USD") {
    return `${account.name} — ${account.ownBalanceExact ? "" : "~"}${formatMoney(
      account.ownBalance,
      { currency: "USD" },
    )}`;
  }
  return `${account.name} — ${formatMoney(account.balance)}`;
}

/** A stored rate as a person types one: 121.500000 reads 121.5. */
function typedRate(rate: string | null | undefined): string {
  if (!rate) return "";
  const value = Number(rate);
  return Number.isFinite(value) ? String(value) : rate;
}

export function TransferForm({
  open,
  accounts,
  transfer,
  onClose,
  onSaved,
}: {
  open: boolean;
  /**
   * The transfer being corrected, or nothing for a new one. The screen mounts
   * a fresh form per transfer (`key`), so the boxes start from its figures.
   */
  transfer?: TransferRowDto;
  /**
   * With balances, because the account rule refuses a transfer past what the
   * account holds — the picker saying "৳48,750.00" beside the name is the
   * warning that arrives before the refusal has to.
   */
  accounts: AccountWithBalance[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /*
   * Which accounts the movement is between, tracked so the form can follow
   * their primary currency: a USD-primary account on either side turns the
   * entry dollars-first, with the taka worked out at the rate beside it —
   * computed until touched, exactly the Cash In rule. The ledger still
   * stores taka.
   */
  const editing = Boolean(transfer);
  const [fromId, setFromId] = useState(
    transfer?.fromAccountId ?? accounts[0]?.id ?? "",
  );
  const [toId, setToId] = useState(
    transfer?.toAccountId ?? accounts[1]?.id ?? "",
  );
  /*
   * A correction keeps its dollars box when the transfer stated dollars, even
   * if one of its accounts has since been archived and is missing from the
   * list that decides this for a new one.
   */
  const usdPrimary =
    [fromId, toId].some(
      (id) =>
        accounts.find((candidate) => candidate.id === id)?.currency === "USD",
    ) || Boolean(transfer?.usdAmount);
  const [usdAmount, setUsdAmount] = useState(transfer?.usdAmount ?? "");
  /*
   * The bank charge in the transfer's own currency: dollars when a dollar
   * account is on either side, taka otherwise — the owner: *"jokhon usd hobe
   * tokhon bank charge o usd howa ucit"*. A correction reopens the charge in
   * the currency it was entered in.
   */
  const entryChargeCurrency: ChargeCurrency = usdPrimary ? "USD" : "BDT";
  const [keptChargeCurrency, setKeptChargeCurrency] =
    useState<ChargeCurrency | null>(
      transfer && Number(transfer.chargeAmount ?? 0) > 0
        ? transfer.chargeUsd
          ? "USD"
          : "BDT"
        : null,
    );
  const chargeCurrency = keptChargeCurrency ?? entryChargeCurrency;
  const [usdRate, setUsdRate] = useState(typedRate(transfer?.usdRate));
  /*
   * A correction opens on the taka it STORED, not a figure recomputed from the
   * dollars and the rate — the bank's figure is the fact, and a rate rounded
   * to six places could otherwise move it by a paisa on a save nobody meant
   * to change it with. Treated as already typed, so it stays put until
   * somebody changes it — or moves the dollars or the rate, at which point the
   * arithmetic takes over again, exactly as a correction on Cash In does.
   */
  const [typedBdt, setTypedBdt] = useState(transfer?.amount ?? "");
  const [bdtTouched, setBdtTouched] = useState(editing);
  /** On a correction, a moved input hands the taka back to the arithmetic. */
  const inputsMoved = () => {
    if (editing) setBdtTouched(false);
  };

  const derivedBdt = (() => {
    const usd = Number(usdAmount.replace(/[,\s$]/g, ""));
    const rate = Number(usdRate.replace(/[,\s]/g, ""));
    if (!Number.isFinite(usd) || usd <= 0) return "";
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return (usd * rate).toFixed(2);
  })();
  // In BDT mode the typed figure is the figure; in USD mode it is computed
  // until touched, then theirs — the Cash In rule.
  const shownBdt = usdPrimary && !bdtTouched ? derivedBdt : typedBdt;
  /*
   * The paper, held until the pair exists to hang it on — the same two slots
   * every money form carries: the invoice (ours) and the bank's record.
   */
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [bankFiles, setBankFiles] = useState<File[]>([]);
  /*
   * What is already on the transfer — on its out half, where its files hang.
   * Listed on the clips, openable, and taken off on save; a new transfer has
   * nothing to list.
   */
  const papers = useStoredPapers(
    "transaction",
    open ? transfer?.outId : undefined,
  );
  /*
   * The "number or slip" choice is gone with the box it governed.
   *
   * It existed to say which of two things a reference was — a number the bank
   * gave, or only the paper. Now there is only the paper, so there is nothing
   * to choose between and nothing to remember choosing.
   */

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      /* What a new transfer and a correction both send. */
      const common = {
        txnDate: String(data.get("txnDate")),
        amount: String(data.get("amount")),
        /* On the FROM account, where a transfer charge is taken. An empty box
           on a correction takes an existing charge off. */
        chargeAmount:
          String(data.get("chargeAmount") ?? "").replace(/[,\s৳]/g, "") ||
          undefined,
        /* Or in dollars — only one of the two boxes is ever drawn. */
        chargeUsd:
          String(data.get("chargeUsd") ?? "").replace(/[,\s$]/g, "") ||
          undefined,
        description: String(data.get("description")),
        /* The rate always; the dollars only when dollars actually moved. */
        usdRate: usdRate.trim(),
        ...(usdPrimary && usdAmount.trim()
          ? { usdAmount: usdAmount.replace(/[,\s$]/g, "") }
          : {}),
        paymentMethod: String(data.get("paymentMethod")) as never,
      };
      const row = transfer
        ? /* Both halves and the charge, together. No accounts: a transfer
             landed in the wrong one is voided and recorded again. */
          await ledgerApi.updateTransfer(transfer.outId, common)
        : await ledgerApi.transfer({
            ...common,
            fromAccountId: String(data.get("fromAccountId")),
            toAccountId: String(data.get("toAccountId")),
            invoiceNo: String(data.get("invoiceNo") ?? "") || undefined,
            reference: String(data.get("reference") ?? "") || undefined,
          });

      /*
       * What was marked to come off goes first, then what was picked goes up
       * — so replacing a slip is one save, and a paper taken off and attached
       * again ends as one copy, not two.
       */
      const unremoved = await papers.commit();

      /*
       * Uploaded one at a time and never thrown: by now the money has moved,
       * and a failed upload must read as "attach it again", not as the
       * transfer having failed.
       */
      /*
       * Flattened, because a clip holds a list now. Still one at a time and
       * still never thrown: by now the money has moved, and a failed upload
       * must read as "attach it again" rather than as the transfer failing.
       */
      const failed: string[] = [];
      for (const slot of [
        ...invoiceFiles.map((file) => ({
          kind: "invoice",
          file,
          name: "invoice",
        })),
        ...bankFiles.map((file) => ({
          kind: "bank_statement",
          file,
          name: "bank record",
        })),
      ]) {
        try {
          await uploadTransactionFile(row.id, slot.file, slot.kind);
        } catch {
          if (!failed.includes(slot.name)) failed.push(slot.name);
        }
      }

      await onSaved();
      if (failed.length || unremoved.length) {
        setInvoiceFiles([]);
        setBankFiles([]);
        setError(
          [
            failed.length
              ? `The transfer is ${editing ? "saved" : "recorded"}, but the ${failed.join(" and the ")} did not upload — open it with Edit and attach again.`
              : null,
            unremoved.length
              ? `${unremoved.map((one) => one.name).join(" and ")} could not be removed: ${unremoved.map((one) => one.reason).join(" ")}`
              : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
        setPending(false);
        return;
      }
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

  if (!editing && accounts.length < 2) {
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
      title={
        transfer ? `Edit transfer ${transfer.refNo}` : "Move money between accounts"
      }
      description={
        editing
          ? "Both entries and the bank charge change together. The accounts cannot change — void it and record it again instead."
          : "Records two entries so each account matches its own statement."
      }
    >
      <form
        id="transfer-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Date" required error={fieldErrors.txnDate}>
          <DateInput
            name="txnDate"
            required
            defaultValue={transfer?.txnDate ?? todayInDhaka()}
          />
        </Field>

        <div className="flex items-end gap-2">
          <Field
            label="From"
            required
            error={fieldErrors.fromAccountId}
            className="flex-1"
          >
            {transfer ? (
              <Select disabled value={transfer.fromAccountId}>
                <option value={transfer.fromAccountId}>
                  {transfer.fromAccountName}
                </option>
              </Select>
            ) : (
              <Select
                name="fromAccountId"
                required
                value={fromId}
                onChange={(event) => setFromId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {optionLabel(account)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ArrowRight className="mb-3 size-4 shrink-0 text-muted-foreground" />
          <Field
            label="To"
            required
            error={fieldErrors.toAccountId}
            className="flex-1"
          >
            {transfer ? (
              <Select disabled value={transfer.toAccountId}>
                <option value={transfer.toAccountId}>
                  {transfer.toAccountName}
                </option>
              </Select>
            ) : (
              <Select
                name="toAccountId"
                required
                value={toId}
                onChange={(event) => setToId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {optionLabel(account)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {/*
          * The rate is asked for on every transfer now, not only the ones with
          * a dollar account on a side — *"puro application a joto dhoroner
          * transaction a hok na keno manually prottekbar rate bosate hobe"*.
          * The dollars box still appears only when dollars actually moved.
          */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {usdPrimary ? (
            <Field
              label="Amount (USD)"
              required
              error={fieldErrors.usdAmount}
              hint="A USD-primary account is on one side — state the dollars that moved."
            >
              <MoneyInput
                required
                placeholder="0.00"
                value={usdAmount}
                onChange={(event) => {
                  setUsdAmount(event.target.value);
                  inputsMoved();
                }}
              />
            </Field>
          ) : null}
          <Field
            label="USD rate"
            required
            error={fieldErrors.usdRate}
            hint="Today's rate, typed. Every entry carries one."
          >
            <Input
              inputMode="decimal"
              className="col-amount"
              placeholder="122.77"
              value={usdRate}
              onChange={(event) => {
                setUsdRate(event.target.value);
                inputsMoved();
              }}
              required
            />
          </Field>
        </div>

        <Field
          label={usdPrimary ? "Amount (BDT)" : "Amount"}
          required
          error={fieldErrors.amount}
          hint={
            usdPrimary
              ? "Worked out from the dollars and the rate. Change it to what actually moved — the ledger counts taka."
              : undefined
          }
        >
          <MoneyInput
            name="amount"
            required
            placeholder="0.00"
            // Always controlled — flipping a field between uncontrolled and
            // controlled mid-open (picking a USD account after typing) is a
            // React warning and a lost value.
            value={shownBdt}
            onChange={(event) => {
              setBdtTouched(true);
              setTypedBdt(event.target.value);
            }}
          />
        </Field>

        {/*
          The bank's cut, as its own row under Bank charges.

          Not folded into the amount: the heading keeps its own figure and the
          charge is visible as a charge — the owner's choice when asked how one
          should count. In the transfer's own currency: dollars when a dollar
          account is on either side, worked out in taka at its rate.
        */}
        <BankChargeField
          currency={chargeCurrency}
          entryCurrency={entryChargeCurrency}
          onUseEntryCurrency={() => setKeptChargeCurrency(null)}
          defaultValue={
            chargeCurrency === "USD"
              ? (transfer?.chargeUsd ?? "")
              : (transfer?.chargeAmount ?? "")
          }
          rate={usdRate}
          error={fieldErrors.chargeUsd ?? fieldErrors.chargeAmount}
        />

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            placeholder="Moved to petty cash"
            defaultValue={transfer?.description ?? ""}
          />
        </Field>

        {/* The pair every money form carries, each with its paper on the
            clip beside it: the invoice number is ours, the transaction id is
            the bank's. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Invoice"
            error={fieldErrors.invoiceNo}
            hint="Attach the invoice itself — there is no number to type"
          >
            <AttachClip
              kind="invoice"
              name={DOCUMENT_NAMES.invoice}
              files={invoiceFiles}
              onPick={setInvoiceFiles}
              papers={papers}
              emptyLabel="No invoice attached"
            />
          </Field>
          {/* Attached, never typed — the same shape Invoice already has, and
              the same change the other three forms got. */}
          <Field
            label="Reference"
            error={fieldErrors.reference}
            hint="Attach the bank's slip — there is no number to type"
          >
            <AttachClip
              kind="bank_statement"
              name={DOCUMENT_NAMES.bank_statement}
              files={bankFiles}
              onPick={setBankFiles}
              papers={papers}
              emptyLabel="No reference attached"
            />
          </Field>
        </div>

        <Field label="Method">
          <Select
            name="paymentMethod"
            defaultValue={transfer?.paymentMethod ?? "bank_transfer"}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
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
          form="transfer-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Record the transfer"}
        </Button>
      </div>
    </Drawer>
  );
}

type DocKind = "invoice" | "bank_statement";

const DOCUMENT_NAMES: Record<DocKind, string> = {
  invoice: "invoice",
  bank_statement: "bank record",
};
