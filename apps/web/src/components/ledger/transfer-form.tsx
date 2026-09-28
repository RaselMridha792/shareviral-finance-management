"use client";

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
} from "@finance/shared";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AttachClip } from "@/components/files/attach-clip";
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
import { ledgerApi } from "@/lib/ledger";
import type { AccountWithBalance } from "@/lib/masters";

/**
 * Moving money between our own accounts. Creates two linked rows — one out,
 * one in — so each account's register matches its own bank statement.
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

export function TransferForm({
  open,
  accounts,
  onClose,
  onSaved,
}: {
  open: boolean;
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
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const usdPrimary = [fromId, toId].some(
    (id) =>
      accounts.find((candidate) => candidate.id === id)?.currency === "USD",
  );
  const [usdAmount, setUsdAmount] = useState("");
  const [usdRate, setUsdRate] = useState("");
  const [typedBdt, setTypedBdt] = useState("");
  const [bdtTouched, setBdtTouched] = useState(false);

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
      const row = await ledgerApi.transfer({
        txnDate: String(data.get("txnDate")),
        fromAccountId: String(data.get("fromAccountId")),
        toAccountId: String(data.get("toAccountId")),
        amount: String(data.get("amount")),
        /* On the FROM account, where a transfer charge is taken. */
        chargeAmount:
          String(data.get("chargeAmount") ?? "").replace(/[,\s৳]/g, "") ||
          undefined,
        description: String(data.get("description")),
        invoiceNo: String(data.get("invoiceNo") ?? "") || undefined,
        reference: String(data.get("reference") ?? "") || undefined,
        /* The rate always; the dollars only when dollars actually moved. */
        usdRate: usdRate.trim(),
        ...(usdPrimary && usdAmount.trim()
          ? { usdAmount: usdAmount.replace(/[,\s$]/g, "") }
          : {}),
        paymentMethod: String(data.get("paymentMethod")) as never,
      });

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
      if (failed.length) {
        setInvoiceFiles([]);
        setBankFiles([]);
        setError(
          `The transfer is recorded, but the ${failed.join(" and the ")} did not upload — open it from the table's number and attach again.`,
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
      <form
        id="transfer-form"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        <Field label="Date" required error={fieldErrors.txnDate}>
          <DateInput name="txnDate" required defaultValue={todayInDhaka()} />
        </Field>

        <div className="flex items-end gap-2">
          <Field
            label="From"
            required
            error={fieldErrors.fromAccountId}
            className="flex-1"
          >
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
          </Field>
          <ArrowRight className="mb-3 size-4 shrink-0 text-muted-foreground" />
          <Field
            label="To"
            required
            error={fieldErrors.toAccountId}
            className="flex-1"
          >
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
                onChange={(event) => setUsdAmount(event.target.value)}
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
              onChange={(event) => setUsdRate(event.target.value)}
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
          should count. In taka whatever currency the account is kept in.
        */}
        <Field
          label="Bank charge (BDT)"
          error={fieldErrors.chargeAmount}
          hint="Its own entry under Bank charges. Leave it empty when there was none."
        >
          <MoneyInput name="chargeAmount" placeholder="0.00" />
        </Field>

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            placeholder="Moved to petty cash"
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
              emptyLabel="No reference attached"
            />
          </Field>
        </div>

        <Field label="Method">
          <Select name="paymentMethod" defaultValue="bank_transfer">
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
          Record the transfer
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
