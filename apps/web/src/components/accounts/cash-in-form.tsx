"use client";

import { isValidAmount, todayInDhaka } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useMoney } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Textarea,
} from "@/components/ui/field";
import { FileManager } from "@/components/files/file-manager";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import { CategorySelect } from "@/components/ledger/category-select";
import {
  categoriesApi,
  type AccountDto,
  type CategoryNode,
} from "@/lib/masters";
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
  const [typedAmount, setTypedAmount] = useState("");
  const [usdSent, setUsdSent] = useState("");

  /**
   * Whether the taka figure was typed rather than worked out.
   *
   * It has to be both. Dollars times the rate is what the transfer *should*
   * have landed as, and it is the right thing to offer — the money starts as
   * dollars and the person has the advice in front of them. But what actually
   * reached the account is a fact, and the bank's charges mean it is regularly
   * a few hundred taka short of the arithmetic. Overwriting a typed figure
   * with a computed one would be the app arguing with the bank statement.
   *
   * So: computed until touched, then left alone.
   */
  const [amountTyped, setAmountTyped] = useState(false);

  const money = useMoney();
  const toast = useToast();

  /**
   * The taka the dollars and the rate come to.
   *
   * Worked out while rendering rather than pushed into state by an effect.
   * An effect would mean the screen briefly shows one figure and then another,
   * and every path that changes the dollars has to remember to keep the taka
   * in step. Derived, there is only ever one answer and nothing to keep in
   * step with anything.
   */
  const derivedAmount = (() => {
    if (!usdSent.trim()) return "";
    const usd = Number(plainAmount(usdSent));
    const rate = Number(plainAmount(usdRate));
    if (!Number.isFinite(usd) || usd <= 0) return "";
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return (usd * rate).toFixed(2);
  })();

  /**
   * Computed until somebody types in the box, then theirs.
   *
   * Dollars times the rate is what the transfer *should* have landed as, and
   * offering it is right — the money starts as dollars and this is the order
   * the advice reads. But what actually reached the account is a fact, and the
   * bank's charges mean it is regularly a few hundred taka short of the
   * arithmetic. Overwriting a typed figure would be the app arguing with the
   * bank statement.
   */
  const amount = amountTyped ? typedAmount : derivedAmount;
  const realised = realisedRate(amount, usdSent);

  /**
   * True when the taka figure no longer matches the rate that was entered.
   *
   * Not an error — this is what a bank charge looks like, and the funding
   * report divides taka by dollars rather than trusting the entered rate, so
   * the realised figure is the one that will be reported. Said out loud
   * because a silent difference between two rates on one screen is the thing
   * worth noticing.
   */
  const enteredRate = Number(plainAmount(usdRate));
  const drifted =
    realised != null &&
    Number.isFinite(enteredRate) &&
    enteredRate > 0 &&
    Math.abs(Number(realised.rate) - enteredRate) >= 0.01;

  /**
   * The saved entry, while its documents are still being attached.
   *
   * A file needs a row to hang on, so the invoice and the statement cannot be
   * part of the same request as the entry itself. The alternative — hold both
   * in the browser and upload after the save returns — has two ways to fail,
   * and the second leaves a saved transfer and a lost invoice with nothing on
   * screen to say which happened.
   *
   * So the drawer does not close on save. It becomes the attach step, with the
   * entry already safe in the ledger. Somebody who walks away has a recorded
   * transfer and no documents, which the table marks — rather than no transfer
   * at all, which is the worse of the two.
   */
  const [saved, setSaved] = useState<TransactionDto | null>(null);

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

  /**
   * The two searchable boxes keep their value here: the form is read with
   * `FormData`, so the value has to reach a hidden input, and a hidden input
   * does not remember anything on its own.
   */
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");

  /**
   * The heading this files under — settled here rather than asked.
   *
   * A transfer from abroad is funding, every time. A select with one right
   * answer and a dozen wrong ones only ever costs somebody a miscategorised
   * month. The API still wants the id, so it is looked up instead of dropped:
   * by slug, off the tree this screen already loaded, because the ids are
   * different in every database and the slugs are not.
   */
  /** Refetched when a heading is added from inside this form. */
  const [tree, setTree] = useState(categories);
  const [categoryId, setCategoryId] = useState(() =>
    fundingCategoryId(categories),
  );

  async function onCategoryCreated() {
    try {
      setTree(await categoriesApi.tree());
    } catch {
      // The new heading is already selected — its id came back from the
      // create. Only its label would be missing until the next page load.
    }
  }

  // Money in can only be filed under a money-in heading.
  const usable = tree.filter(
    (group) => group.kind === "in" || group.kind === "both",
  );

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
    setTypedAmount("");
    setUsdSent("");
    setAmountTyped(false);
    setSaved(null);
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /**
     * No money-in heading anywhere in the tree, which happens on a database
     * the category seed never ran against. Caught here rather than sent,
     * because the select would be empty and a 400 saying "Choose a category"
     * over a list with nothing in it reads as the form being broken.
     */
    if (!categoryId) {
      setError(
        "There is no money-in category to file this under. Add one in Settings → Categories first.",
      );
      return;
    }

    setPending(true);
    setError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const text = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? undefined : value;
    };

    try {
      const created = await ledgerApi.recordCashIn({
        txnDate: String(data.get("txnDate")),
        reference: text("reference"),
        // The company's own number for the transfer, as against `reference`,
        // which is the bank's. It was on screen, marked required, and never
        // sent — so every one typed since this form shipped was dropped on the
        // way out, and the column that shows it would have read blank forever.
        invoiceNo: text("invoiceNo"),
        description: String(data.get("description")),
        accountId: String(data.get("accountId")),
        amount: String(data.get("amount")),
        categoryId,
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
      toast.show("Transfer recorded. Attach the documents to finish.");
      await onSaved();
      setSaved(created);
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
      title="Add cash"
      description="Money received from abroad, as the remittance advice states it."
    >
      {saved ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-positive/10 px-4 py-3 text-sm">
            <span className="font-medium">Recorded as</span>{" "}
            <span className="num">{saved.refNo}</span>. It is in the ledger
            already — attaching the documents is the last step.
          </p>

          {/*
            Two uploaders rather than one with a kind picker. The pair is what
            a remittance comes with, and naming them separately is the
            difference between "documents: 2" and being able to answer "show me
            the invoice for this transfer" three months from now.
          */}
          <Field
            label="Invoice PDF"
            required
            hint="The bill this transfer settles"
          >
            <FileManager
              owner="transaction"
              ownerId={saved.id}
              kinds={["invoice"]}
              canWrite
              emptyLabel="No invoice attached yet."
            />
          </Field>

          <Field
            label="Bank statement screenshot"
            required
            hint="The bank's own record that the money arrived"
          >
            <FileManager
              owner="transaction"
              ownerId={saved.id}
              kinds={["bank_statement"]}
              canWrite
              emptyLabel="No statement attached yet."
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            Closing without attaching leaves the transfer recorded and its
            documents missing. The transactions table marks those rows, so they
            can be found and finished later.
          </p>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          id="cash-in-form"
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" required error={fieldErrors.txnDate}>
              <DateInput
                name="txnDate"
                required
                defaultValue={todayInDhaka()}
              />
            </Field>
            <Field
              label="Landed in"
              required
              error={fieldErrors.accountId}
              hint="Our account the transfer arrived in"
            >
              <SearchableSelect
                name="accountId"
                value={accountId}
                onChange={setAccountId}
                invalid={Boolean(fieldErrors.accountId?.length)}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                  hint: account.bankName ?? undefined,
                }))}
                placeholder="Choose an account"
                searchPlaceholder="Type to find an account…"
              />
            </Field>
          </div>

          {/* The dollar side first, because that is the side the money starts
            on and the side nobody can reconstruct afterwards. The rate is
            asked at the only moment anybody knows it: it is read back all
            month, since every taka figure is shown in dollars at the rate the
            month's funding arrived at, and a rate looked up later is the rate
            on the day of the lookup. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="USD sent"
              error={fieldErrors.usdSent}
              hint="What the sender sent. Blank for a local receipt."
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
                  ? `Last recorded: ${trimRate(latestRate)} per USD. It governs the whole month.`
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

          <Field
            label="Amount received"
            required
            error={fieldErrors.amount}
            hint={
              amountTyped
                ? "What landed, in taka — as you typed it"
                : "Worked out from the two above. Change it to what the bank actually credited."
            }
          >
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              value={amount}
              onChange={(event) => {
                setTypedAmount(event.target.value);
                // From here on this box is the person's, not the arithmetic's.
                setAmountTyped(true);
              }}
            />
          </Field>

          {/* The arithmetic, back in front of the person who typed it. A digit
            too many in either box turns a plausible rate into an absurd one,
            and that is obvious here and nearly invisible in a report next
            quarter. This is also the figure the funding report will show for
            this transfer — it divides the same two numbers rather than
            trusting the rate that was typed. */}
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
              {drifted ? (
                <>
                  {" "}
                  That is not {trimRate(usdRate)}, which is normal when the bank
                  takes a charge — the funding report will show{" "}
                  {money(realised.rate)}.
                </>
              ) : null}
            </p>
          ) : usdSent.trim() ? (
            <p className="text-xs text-muted-foreground">
              Enter the rate and the taka figure fills itself in.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave <span className="font-medium">USD sent</span> blank for a
              local receipt and type the taka directly. Filled in, this transfer
              appears in the funding report with the rate it achieved.
            </p>
          )}

          {/*
          Two reference numbers, because the paperwork has two and they answer
          different questions. The invoice is ours — what the transfer was
          against. The transaction id is the bank's — what to quote when asking
          them about it. One field would hold whichever was typed first.
        */}
          <Field label="Category" required error={fieldErrors.categoryId}>
            <CategorySelect
              name="categoryId"
              value={categoryId}
              onChange={setCategoryId}
              categories={usable}
              // Money arriving, so a heading added from here belongs on the
              // money-in side. Getting this wrong would file a heading where
              // this very form could never offer it again.
              kind="in"
              invalid={Boolean(fieldErrors.categoryId?.length)}
              onCreated={onCategoryCreated}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Invoice no."
              required
              error={fieldErrors.invoiceNo}
              hint="The invoice this transfer settles"
            >
              <Input
                name="invoiceNo"
                required
                className="num"
                placeholder="INV-002"
              />
            </Field>

            <Field
              label="Transaction id"
              required
              error={fieldErrors.reference}
              hint="The bank's reference for this transfer"
            >
              <Input
                name="reference"
                required
                className="num"
                placeholder="FT26081200412"
              />
            </Field>
          </div>

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

            <Field
              label="Account number"
              error={fieldErrors.senderAccountNumber}
            >
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
      )}

      {/* The footer belongs to the form step only — the attach step carries
          its own Done, and a Cancel beside an entry that is already saved
          would read as if it could undo it. */}
      {saved ? null : (
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
            Add it
          </Button>
        </div>
      )}
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
 * Where a transfer from abroad belongs.
 *
 * "CEO funding" under "Money in" is what the category seed writes, and it is
 * the answer for every row this form has ever produced. Matched on slug and
 * not on a pasted uuid — the ids are per-database, the slugs are per-seed —
 * and under its parent, because a slug is only unique within one.
 *
 * Then two fallbacks, because the seed is a script somebody has to remember to
 * run and a database that never saw it must still be able to take a transfer:
 * any active money-in heading named like funding, then simply the first one.
 * Empty only when there is no money-in side at all, which `onSubmit` refuses
 * rather than sending — the API would reject it anyway, without saying why in
 * terms anybody could act on.
 */
function fundingCategoryId(groups: CategoryNode[]): string {
  const moneyIn = groups.filter(
    (group) => group.kind === "in" || group.kind === "both",
  );

  const seeded = moneyIn
    .find((group) => group.slug === "money-in")
    ?.children.find((child) => child.slug === "ceo-funding" && child.isActive);
  if (seeded) return seeded.id;

  for (const group of moneyIn) {
    const funding = group.children.find(
      (child) => child.isActive && /funding/i.test(child.name),
    );
    if (funding) return funding.id;
  }

  const first = moneyIn[0];
  if (!first) return "";
  return first.children.find((child) => child.isActive)?.id ?? first.id;
}

/** The stored column is "118.750000"; a person reads "118.75". */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}
