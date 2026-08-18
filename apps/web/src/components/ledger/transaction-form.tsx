"use client";

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
  type TxnDirection,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { FileManager } from "@/components/files/file-manager";
import { CategorySelect } from "@/components/ledger/category-select";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import { fxApi } from "@/lib/reports";
import { categoriesApi, type AccountDto, type CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";

export function TransactionForm({
  open,
  transaction,
  defaultDirection = "out",
  lockDirection = false,
  defaultAccountId,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  transaction?: TransactionDto;
  defaultDirection?: TxnDirection;
  /**
   * Hides the in/out switch and keeps the form on `defaultDirection`.
   *
   * Set on every Expenses screen. Money coming in never belongs on a page
   * about what the company spent, and offering the choice there is offering a
   * way to file a receipt under Expenses — where nobody would think to look
   * for it afterwards. Cash-in has its own form, which asks the questions a
   * remittance actually needs.
   */
  lockDirection?: boolean;
  defaultAccountId?: string;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const editing = Boolean(transaction);

  /**
   * A just-created entry, while its document is being attached.
   *
   * Documents were asked for on every entry, and a file needs a row to hang on
   * — so the entry has to exist first. The drawer therefore does not close on a
   * create: it becomes the attach step, with the entry already safe in the
   * ledger. Somebody who leaves at that point has a recorded entry and no
   * document, which the table marks in amber.
   *
   * Editing is unaffected. That row already exists, so its uploader sits in the
   * form where it always has.
   */
  const [saved, setSaved] = useState<TransactionDto | null>(null);
  const toast = useToast();
  const [direction, setDirection] = useState<TxnDirection>(
    transaction?.direction ?? defaultDirection,
  );
  const [showTax, setShowTax] = useState(
    Boolean(transaction && Number(transaction.withheldTaxAmount) > 0),
  );
  const [showFx, setShowFx] = useState(Boolean(transaction?.originalAmount));

  /**
   * The rate is captured per entry, so it needs a sensible starting point.
   * The last one recorded is almost always today's, and being wrong by a
   * paisa is far better than the field being left empty — an empty rate
   * means no dollar figure on the statement for that line at all.
   */
  const [usdRate, setUsdRate] = useState(transaction?.usdRate ?? "");
  const [latestRate, setLatestRate] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void fxApi
      .rates(1)
      .then((rates) => {
        if (cancelled) return;
        const last = rates[0]?.rate ?? null;
        setLatestRate(last);
        // Never overwrite what is already on the row being edited, or what
        // the person has started typing.
        setUsdRate((current) => current || (last ?? ""));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * The two searchable boxes hold their value in state, because a hidden input
   * is what carries it into `FormData` and a hidden input has nothing to
   * remember it for you.
   *
   * Seeded from the row being edited, or from the caller's default. Safe to
   * seed from props: the drawer unmounts its children on close, so this is
   * built fresh every time the form opens.
   */
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? "");

  /**
   * A category added from inside this form is not in the tree the parent
   * screen handed down, so the list is kept here and refetched once.
   */
  const [tree, setTree] = useState(categories);
  async function onCategoryCreated() {
    try {
      setTree(await categoriesApi.tree());
    } catch {
      // The new category is selected either way — the id came back from the
      // create. Only its name would be missing from the list until the page
      // is next loaded, which is not worth failing a save over.
    }
  }

  // A money-out entry may only use a money-out category, and the reverse.
  const usable = tree.filter(
    (group) => group.kind === direction || group.kind === "both",
  );

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

    let created: TransactionDto | null = null;

    try {
      if (transaction) {
        await ledgerApi.update(transaction.id, {
          txnDate: text("txnDate"),
          amount: text("amount"),
          categoryId: text("categoryId"),
          // No vendorName: the form no longer collects one. Left out rather
          // than sent empty, so editing an older entry that has one keeps it
          // instead of quietly clearing it.
          paymentMethod: text("paymentMethod") as never,
          reference: text("reference"),
          invoiceNo: text("invoiceNo"),
          description: text("description"),
          notes: text("notes"),
          receiptUrl: text("receiptUrl"),
          billAmount: showTax ? text("billAmount") : undefined,
          withheldTaxAmount: showTax ? text("withheldTaxAmount") : undefined,
        });
      } else {
        created = await ledgerApi.create({
          direction,
          txnDate: String(data.get("txnDate")),
          accountId: String(data.get("accountId")),
          amount: String(data.get("amount")),
          categoryId: String(data.get("categoryId")),
          paymentMethod: (text("paymentMethod") ?? "bank_transfer") as never,
          reference: text("reference"),
          invoiceNo: text("invoiceNo"),
          description: String(data.get("description")),
          notes: text("notes"),
          receiptUrl: text("receiptUrl"),
          billAmount: showTax ? text("billAmount") : undefined,
          withheldTaxAmount: showTax ? text("withheldTaxAmount") : undefined,
          usdRate: text("usdRate"),
          originalAmount: showFx ? text("originalAmount") : undefined,
          originalCurrency: showFx ? "USD" : undefined,
          fxRate: showFx ? text("fxRate") : undefined,
        } as never);
      }
      await onSaved();

      if (created) {
        toast.show(`${created.refNo} recorded. Attach the document to finish.`);
        setSaved(created);
      } else {
        toast.show(`${transaction?.refNo} updated.`);
        onClose();
      }
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
      title={editing ? `Edit ${transaction?.refNo}` : "Record a movement"}
      description={
        editing
          ? "The account and the direction cannot change — void it and enter a new one instead."
          : undefined
      }
    >
      {saved ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-positive/10 px-4 py-3 text-sm">
            <span className="font-medium">Recorded as</span>{" "}
            <span className="num">{saved.refNo}</span>. It is in the ledger
            already — the document is the last step.
          </p>

          <Field
            label="Receipt or screenshot"
            required
            hint="Proof this movement happened. Kept on this company's own server."
          >
            <FileManager
              owner="transaction"
              ownerId={saved.id}
              kinds={["receipt", "invoice", "bank_statement", "other"]}
              canWrite
              emptyLabel="Nothing attached yet."
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            Closing without attaching leaves the entry recorded and undocumented.
            The table marks those rows in amber so they can be found and
            finished later.
          </p>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setSaved(null);
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
      <form id="txn-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        {!editing && !lockDirection ? (
          <div
            role="radiogroup"
            aria-label="Direction"
            className="grid grid-cols-2 gap-2"
          >
            {(["out", "in"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={direction === value}
                onClick={() => setDirection(value)}
                className={cn(
                  "cursor-pointer rounded-lg border px-3 py-2.5 text-sm font-medium transition",
                  direction === value
                    ? value === "in"
                      ? "border-positive bg-positive/10 text-positive"
                      : "border-negative bg-negative/10 text-negative"
                    : "border-border text-muted-foreground hover:bg-surface-muted",
                )}
              >
                {value === "in" ? "Money in" : "Money out"}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date" required error={fieldErrors.txnDate}>
            <DateInput
              name="txnDate"
              required
              defaultValue={transaction?.txnDate ?? todayInDhaka()}
            />
          </Field>
          <Field label="Amount" required error={fieldErrors.amount}>
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              defaultValue={transaction?.amount}
            />
          </Field>
        </div>

        {!editing ? (
          <Field label="Account" required error={fieldErrors.accountId}>
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
        ) : null}

        <Field label="Category" required error={fieldErrors.categoryId}>
          <CategorySelect
            name="categoryId"
            value={categoryId}
            onChange={setCategoryId}
            categories={usable}
            kind={direction}
            invalid={Boolean(fieldErrors.categoryId?.length)}
            onCreated={onCategoryCreated}
          />
        </Field>

        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            placeholder="August office rent"
            defaultValue={transaction?.description}
          />
        </Field>

        {/* There was a "Paid to" box here that created a vendor from whatever
            was typed. The company does not keep a supplier list — what it has
            is tools and subscriptions, which have their own screen — and a
            free-text box that silently creates master data is how "150000.00"
            once became a vendor, from an amount tabbed into the wrong field.
            Who was paid belongs in the description. */}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Paid by" error={fieldErrors.paymentMethod}>
            <Select
              name="paymentMethod"
              defaultValue={transaction?.paymentMethod ?? "bank_transfer"}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Reference"
            error={fieldErrors.reference}
            hint="Cheque or bank reference — theirs"
          >
            <Input
              name="reference"
              className="num"
              defaultValue={transaction?.reference ?? ""}
            />
          </Field>
        </div>

        {/*
          Two reference numbers, because the paperwork has two. The one above
          is the bank's — a cheque number, a wire reference. This one is the
          company's own: the number on the invoice or the payroll sheet the
          money was against. A single box would hold whichever was typed first.
        */}
        <Field
          label="Invoice no."
          error={fieldErrors.invoiceNo}
          hint="The document this was against — INV-002, SAL-JUL. Ours."
        >
          <Input
            name="invoiceNo"
            className="num"
            placeholder="INV-002"
            defaultValue={transaction?.invoiceNo ?? ""}
          />
        </Field>

        <Field
          label="Receipt link"
          error={fieldErrors.receiptUrl}
          hint="Paste the Google Drive link"
        >
          <Input
            name="receiptUrl"
            type="url"
            placeholder="https://drive.google.com/…"
            defaultValue={transaction?.receiptUrl ?? ""}
          />
        </Field>

        {/*
          Uploading needs a row to attach to, so this only appears once the
          entry exists. Offering it while recording would mean holding the file
          in the browser until the save returned an id and then uploading it —
          two ways to fail where the second one leaves a saved transaction and
          a lost receipt, and no way for the person to tell which happened.
        */}
        {editing && transaction ? (
          <Field
            label="Receipt files"
            hint="Kept on this company's own server"
          >
            <FileManager
              owner="transaction"
              ownerId={transaction.id}
              kinds={["receipt", "other"]}
              canWrite
              emptyLabel="No receipt uploaded for this entry."
            />
          </Field>
        ) : null}

        {/*
          Tax withheld: behind a toggle because most entries have none, and
          money-out only. Tax a client deducts from money they send us is an
          advance-tax credit, not something we owe the treasury — offering the
          field here would let someone book a deposit obligation that does not
          exist.
        */}
        {direction === "out" ? (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={showTax}
              onChange={(event) => setShowTax(event.target.checked)}
              className="size-4 accent-primary"
            />
            Tax was withheld from this payment
          </label>
        ) : null}

        {/* Asked on the way past, not applied afterwards.

            A statement shows every taka figure in dollars too, and the only
            moment the right rate is known is the moment the entry is made — a
            rate looked up at report time is the rate on the day of the lookup.
            Prefilled with the last one recorded so it is a glance, not a
            research task, and editable because the day's rate is the point. */}
        <Field
          label="Dollar rate today"
          error={fieldErrors.usdRate}
          hint={
            latestRate
              ? `Last recorded: ৳${latestRate} per USD. Change it if today is different.`
              : "What one US dollar is worth today, in taka."
          }
        >
          <Input
            name="usdRate"
            inputMode="decimal"
            className="num"
            placeholder="122.77"
            value={usdRate}
            onChange={(event) => setUsdRate(event.target.value)}
          />
        </Field>

        {showTax && direction === "out" ? (
          <div className="grid gap-4 rounded-lg bg-surface-muted p-4 sm:grid-cols-2">
            <Field
              label="Gross bill"
              error={fieldErrors.billAmount}
              hint="Before tax was deducted"
            >
              <MoneyInput
                name="billAmount"
                defaultValue={transaction?.billAmount ?? ""}
              />
            </Field>
            <Field label="Tax withheld" error={fieldErrors.withheldTaxAmount}>
              <MoneyInput
                name="withheldTaxAmount"
                defaultValue={
                  transaction && Number(transaction.withheldTaxAmount) > 0
                    ? transaction.withheldTaxAmount
                    : ""
                }
              />
            </Field>
          </div>
        ) : null}

        {!editing && direction === "in" ? (
          <>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={showFx}
                onChange={(event) => setShowFx(event.target.checked)}
                className="size-4 accent-primary"
              />
              This arrived as a foreign currency transfer
            </label>

            {showFx ? (
              <div className="grid gap-4 rounded-lg bg-surface-muted p-4 sm:grid-cols-2">
                <Field
                  label="USD sent"
                  error={fieldErrors.originalAmount}
                  hint="What left the sender"
                >
                  <MoneyInput name="originalAmount" placeholder="5000.00" />
                </Field>
                <Field
                  label="Rate the bank gave"
                  error={fieldErrors.fxRate}
                  hint="Kept forever, never re-translated"
                >
                  <Input
                    name="fxRate"
                    className="col-amount"
                    inputMode="decimal"
                    placeholder="118.40"
                  />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" defaultValue={transaction?.notes ?? ""} />
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

      {/* The attach step carries its own Done. A Cancel beside an entry that
          is already in the ledger would read as if it could undo it. */}
      {saved ? null : (
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="txn-form"
            variant="primary"
            disabled={pending}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {editing ? "Save changes" : "Record it"}
          </Button>
        </div>
      )}
    </Drawer>
  );
}
