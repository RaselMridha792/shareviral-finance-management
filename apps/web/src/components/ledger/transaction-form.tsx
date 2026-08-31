"use client";

import {
  ALLOWED_MIME_TYPES,
  formatFileSize,
  MAX_FILE_BYTES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  todayInDhaka,
  type TxnDirection,
} from "@finance/shared";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

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
import {
  ReferenceInput,
  ReferenceKindToggle,
  type ReferenceKind,
} from "@/components/ledger/reference-kind";
import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import { fxApi } from "@/lib/reports";
import {
  categoriesApi,
  type AccountDto,
  type CategoryNode,
} from "@/lib/masters";
import { cn } from "@/lib/utils";
import { PreviewButton, useFilePreview } from "@/components/files/file-preview";

/**
 * The two files a movement comes with, under the kinds the ledger already
 * uses — the same pair, and the same control, as the cash-in form. The second
 * one is a screenshot of the bank's own record and that is what the button
 * says, but the kind stays `bank_statement`: renaming it would leave every
 * document already filed under it in a category nothing looks in.
 */
type DocKind = "invoice" | "bank_statement";

const DOCUMENT_NAMES: Record<DocKind, string> = {
  invoice: "invoice or receipt",
  bank_statement: "transaction screenshot",
};

/** What may be filed against a movement, once the row exists to hold it. */
const DOCUMENT_KINDS = [
  "receipt",
  "invoice",
  "bank_statement",
  "other",
] as const;

/**
 * One movement, in the shape of the sheet it replaces.
 *
 * The owner's expenses sheet asks for the date, the category, the description,
 * the taka, the dollars, how it was paid, the reference number and the rate,
 * and the labels here are its words — so a row can be moved across without
 * anybody having to work out which box is which. Two things the sheet cannot
 * carry are asked for as well: which of our accounts the money went through,
 * and the paper behind each of the two reference numbers.
 *
 * Shared by every screen that records or corrects a movement — the account
 * register, Expenses, Other expenses, a category page, the full ledger — so
 * nothing here may assume the money is going out, or that the row is new.
 */
export function TransactionForm({
  open,
  transaction,
  defaultDirection = "out",
  lockDirection = false,
  defaultAccountId,
  defaultCategoryId,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  transaction?: TransactionDto;
  defaultDirection?: TxnDirection;
  /**
   * The heading a new entry starts under.
   *
   * A category page's Add button names the heading it adds to — "add Office &
   * premises" — so opening a drawer that then asks which heading would be
   * asking a question the button already answered.
   *
   * Only for a new row. An existing one keeps its own, which is the whole
   * point of it being on the record.
   */
  defaultCategoryId?: string;
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
   * A just-saved entry, while its documents are being dealt with.
   *
   * Two different things put the form here. Either nothing was clipped on and
   * the entry has no document at all — the drawer stays open as the attach
   * step rather than closing on a row the table will mark in amber — or
   * something was clipped on and its upload failed after the money was already
   * recorded. The second is the one worth the machinery: reporting a save that
   * worked as a failure would be a lie, and swallowing the lost file would be
   * a worse one.
   *
   * The ordinary ending — files picked, entry saved, files up — just closes.
   */
  const [saved, setSaved] = useState<TransactionDto | null>(null);
  const [failed, setFailed] = useState<{ kind: DocKind; reason: string }[]>([]);
  const toast = useToast();
  const [direction, setDirection] = useState<TxnDirection>(
    transaction?.direction ?? defaultDirection,
  );
  const [showTax, setShowTax] = useState(
    Boolean(transaction && Number(transaction.withheldTaxAmount) > 0),
  );
  const [showFx, setShowFx] = useState(Boolean(transaction?.originalAmount));
  /*
   * A transaction id, or only the paper. Read back from the row being edited
   * rather than stored — see components/ledger/reference-kind.tsx.
   */
  const [refKind, setRefKind] = useState<ReferenceKind>(
    transaction && !transaction.reference ? "paper" : "id",
  );

  /**
   * The taka, held here rather than left to the DOM, so the dollar figure
   * below it can be read back while it is being typed. A digit too many is
   * obvious there and nearly invisible a quarter later, in a report that
   * quietly says the office rent was $3,703.
   */
  const [amount, setAmount] = useState(transaction?.amount ?? "");

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
    /**
     * Only while recording. On an old row that has no rate, prefilling today's
     * would put today's rate on last July's rent the moment somebody opened
     * the row to fix a typo — and the rate is saved on an edit now, so that
     * would not stay a display quirk.
     */
    if (editing) return;
    let cancelled = false;

    void fxApi
      .rates(1)
      .then((rates) => {
        if (cancelled) return;
        const last = rates.items[0]?.rate ?? null;
        setLatestRate(last);
        // Never overwrite what the person has started typing.
        setUsdRate((current) => current || (last ?? ""));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [open, editing]);

  /**
   * The sheet's dollar column: the taka over the rate beside it.
   *
   * Worked out while rendering rather than pushed into state by an effect —
   * derived, there is only ever one answer and nothing to keep in step with
   * anything. Blank until both figures are usable, so a half-typed amount
   * shows nothing rather than lurching through several alarming values on the
   * way to the right one.
   */
  const usdAmount = (() => {
    const bdt = Number(plainAmount(amount));
    const rate = Number(plainAmount(usdRate));
    if (!Number.isFinite(bdt) || bdt <= 0) return "";
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return (bdt / rate).toFixed(2);
  })();

  /**
   * The two files, picked while the rest is being typed and held here until
   * there is something to hang them on.
   *
   * They cannot go up any earlier: an upload is addressed to a transaction id,
   * and on a new entry that id does not exist until this form is submitted.
   * Holding them is what lets both be chosen in the same pass as the numbers
   * they belong to.
   */
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);

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

  /*
   * The owner's rule: an account chooses its primary currency, and the form
   * follows the account. On a USD-primary account the dollars are what the
   * person knows — the card was charged $40 — so the dollars are typed and
   * the taka is worked out, the exact reverse of the BDT form. The ledger
   * still stores taka; the typed dollars ride along as the recorded original.
   */
  const usdPrimary =
    accounts.find((candidate) => candidate.id === accountId)?.currency ===
    "USD";
  const [usdEntered, setUsdEntered] = useState(
    transaction?.originalAmount ?? "",
  );
  /** On an edit the stored taka is authoritative — nothing recomputes it. */
  const [bdtTouched, setBdtTouched] = useState(Boolean(transaction));
  /** The other direction, for a USD-primary account: dollars × rate. */
  const derivedBdt = (() => {
    const usd = Number(plainAmount(usdEntered));
    const rate = Number(plainAmount(usdRate));
    if (!Number.isFinite(usd) || usd <= 0) return "";
    if (!Number.isFinite(rate) || rate <= 0) return "";
    return (usd * rate).toFixed(2);
  })();

  /** Computed until somebody types in the taka box, then theirs. */
  const shownAmount = usdPrimary && !bdtTouched ? derivedBdt : amount;
  const [categoryId, setCategoryId] = useState(
    transaction?.categoryId ?? defaultCategoryId ?? "",
  );

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

  /**
   * Closing empties what the drawer would not.
   *
   * Most of this form is uncontrolled and unmounts with the panel, so it comes
   * back blank on its own. The amount and the two picked files are held up
   * here and would not, and a reopened form still carrying the last entry's
   * figure is how the same payment gets recorded twice. The rate is
   * deliberately kept — it is prefilled from the last one recorded anyway.
   */
  function close() {
    setAmount("");
    setInvoiceFile(null);
    setScreenshotFile(null);
    /**
     * Anything attached from the panel above landed after the table was last
     * refreshed, so ask for it again on the way out — otherwise the row whose
     * receipt was just attached still reads as having nothing on it.
     */
    if (saved) void onSaved();
    setSaved(null);
    setFailed([]);
    onClose();
  }

  /** The clips with a file in them, in the order they appear on the form. */
  function chosen(): { kind: DocKind; file: File }[] {
    return [
      { kind: "invoice" as const, file: invoiceFile },
      { kind: "bank_statement" as const, file: screenshotFile },
    ].filter(
      (slot): slot is { kind: DocKind; file: File } => slot.file !== null,
    );
  }

  /**
   * Send whatever was picked, now that there is a row to address it to.
   *
   * One at a time, and never throwing. A failed invoice must not stop the
   * screenshot from going up, and neither of them may surface as the save
   * having failed — by the time this runs the entry is already in the ledger.
   */
  async function attach(transactionId: string) {
    const failures: { kind: DocKind; reason: string }[] = [];

    for (const slot of chosen()) {
      try {
        await uploadTransactionFile(transactionId, slot.file, slot.kind);
      } catch (caught) {
        failures.push({
          kind: slot.kind,
          reason:
            caught instanceof ApiError
              ? caught.message
              : "The upload did not go through.",
        });
      }
    }

    return failures;
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
      const row = transaction
        ? await ledgerApi.update(transaction.id, {
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
            // Sent on an edit too, now that the dollar figure on this form is
            // read off it — a rate box that showed a number and then dropped
            // it would be the form disagreeing with the table over the same
            // row. `text` omits an empty box, so a row that has a rate can
            // never be cleared by opening it and saving.
            usdRate: text("usdRate"),
            billAmount: showTax ? text("billAmount") : undefined,
            withheldTaxAmount: showTax ? text("withheldTaxAmount") : undefined,
          })
        : await ledgerApi.create({
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
            billAmount: showTax ? text("billAmount") : undefined,
            withheldTaxAmount: showTax ? text("withheldTaxAmount") : undefined,
            usdRate: text("usdRate"),
            // On a USD-primary account the typed dollars ARE the original —
            // the money moved as dollars, converted at the rate beside them.
            originalAmount: usdPrimary
              ? plainAmount(usdEntered) || undefined
              : showFx
                ? text("originalAmount")
                : undefined,
            originalCurrency:
              usdPrimary || showFx ? ("USD" as const) : undefined,
            fxRate: usdPrimary
              ? text("usdRate")
              : showFx
                ? text("fxRate")
                : undefined,
          } as never);

      const picked = chosen().length;
      const failures = await attach(row.id);

      // Before any of the endings: the row is in the table now, and how many
      // documents hang on it is part of what that table draws.
      await onSaved();

      if (failures.length > 0) {
        toast.show(
          `${row.refNo} saved, but a document did not upload.`,
          "error",
        );
        setFailed(failures);
        setSaved(row);
        return;
      }

      if (editing || picked > 0) {
        toast.show(
          picked > 0
            ? `${row.refNo} ${editing ? "updated" : "recorded"}, documents attached.`
            : `${row.refNo} updated.`,
        );
        close();
        return;
      }

      // A new entry with nothing clipped to it. The drawer becomes the step
      // that gives it a document, rather than closing on a row that has none.
      toast.show(`${row.refNo} recorded. Attach the document to finish.`);
      setSaved(row);
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
      title={editing ? `Edit ${transaction?.refNo}` : "Record a movement"}
      description={
        editing
          ? "The account and the direction cannot change — void it and enter a new one instead."
          : undefined
      }
    >
      {saved ? (
        <div className="flex flex-col gap-4">
          <p
            className={cn(
              "rounded-lg px-4 py-3 text-sm",
              failed.length ? "bg-negative/10" : "bg-positive/10",
            )}
          >
            <span className="font-medium">
              {editing ? "Saved as" : "Recorded as"}
            </span>{" "}
            <span className="num">{saved.refNo}</span>
            {failed.length ? (
              <>
                {" "}
                — the entry is in the ledger and the table already has it. What
                did not go up is the{" "}
                {failed
                  .map((slot) => DOCUMENT_NAMES[slot.kind])
                  .join(" and the ")}
                : {failed.map((slot) => slot.reason).join(" ")} Attaching it
                here needs nothing typed again.
              </>
            ) : (
              <>
                . It is in the ledger already — the document is the last step.
              </>
            )}
          </p>

          <Field
            label="Receipt or screenshot"
            required
            hint="Proof this movement happened. Kept on this company's own server."
          >
            <FileManager
              owner="transaction"
              ownerId={saved.id}
              kinds={
                failed.length ? failed.map((slot) => slot.kind) : DOCUMENT_KINDS
              }
              canWrite
              emptyLabel="Nothing attached yet."
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            Closing without attaching leaves the entry recorded and
            undocumented. The table marks those rows in amber so they can be
            found and finished later.
          </p>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="primary" onClick={close}>
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
          </div>

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

          {/* The two figures that are typed, then the one they come to. The sheet
            prints taka, dollars, rate; this asks taka, rate, dollars, because
            an answer printed above its own inputs is a box that appears to
            change on its own.

            The rate is asked on the way past rather than applied afterwards: a
            statement shows every taka figure in dollars too, and the only
            moment the right rate is known is the moment of the entry — a rate
            looked up at report time is the rate on the day of the lookup. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {usdPrimary ? (
              <Field
                label="Amount (USD)"
                required
                error={fieldErrors.originalAmount}
                hint="This account's primary currency — the figure on the card's own statement."
              >
                <MoneyInput
                  name="usdEntered"
                  required
                  placeholder="0.00"
                  value={usdEntered}
                  onChange={(event) => setUsdEntered(event.target.value)}
                />
              </Field>
            ) : (
              <Field label="Amount (BDT)" required error={fieldErrors.amount}>
                <MoneyInput
                  name="amount"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
            )}
            <Field
              label="USD Rate"
              error={fieldErrors.usdRate}
              hint={
                latestRate
                  ? `Last recorded: ৳${latestRate} per USD. Change it if the day was different.`
                  : "What one US dollar was worth on the day, in taka."
              }
            >
              <Input
                name="usdRate"
                inputMode="decimal"
                className="col-amount"
                placeholder="122.77"
                value={usdRate}
                onChange={(event) => setUsdRate(event.target.value)}
              />
            </Field>
          </div>

          {usdPrimary ? (
            <Field
              label="Amount (BDT)"
              required
              error={fieldErrors.amount}
              hint="Worked out from the dollars and the rate. Change it to what the bank actually took — the ledger counts taka."
            >
              <MoneyInput
                name="amount"
                required
                placeholder="0.00"
                value={shownAmount}
                onChange={(event) => {
                  setBdtTouched(true);
                  setAmount(event.target.value);
                }}
              />
            </Field>
          ) : null}

          {/*
          Read back, never typed — and gone entirely while a transfer's own
          dollars are being entered below, because that figure is what actually
          left the sender and this one is a translation of the taka. Two
          different dollar amounts on one screen is a question nobody should
          have to answer.

          A readout rather than a box because there is nowhere for a typed
          dollar figure to go. Every screen that shows a taka line in dollars
          divides the amount by the rate on the row, and the only columns that
          hold a dollar amount of their own — `originalAmount` and `fxRate` —
          mean the money moved as dollars, which is a different fact and is
          asked separately. A box that accepted a figure and dropped it on save
          would be worse than no box at all. The way to change what this says
          is to change the rate, which is the one of the three genuinely in
          doubt.
        */}
          {showFx || usdPrimary ? null : (
            <Field
              label="Amount (USD)"
              hint="Worked out from the taka and the rate, the way the sheet does it."
            >
              <MoneyInput
                readOnly
                value={usdAmount}
                placeholder="—"
                className="text-muted-foreground"
              />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Payment Method" error={fieldErrors.paymentMethod}>
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

            {/* Beside the method, because between them they answer one question:
              how the money moved, and which of our accounts it moved through.
              Asked only while recording — an entry cannot change account
              afterwards, it is voided and entered again. */}
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
          </div>

          {/*
          Two reference numbers, because the paperwork has two, and each with
          the paper it refers to on the clip beside it. The first is the
          company's own — the number on the invoice or the payroll sheet the
          money was against — the sheet's Invoice No.
          The second is the bank's: what to quote when asking them about the
          movement. A single box would hold whichever was typed first.

          Both stay optional. The sheet leaves its reference column blank on
          plenty of rows, and every screen that edits an old entry opens rows
          from before either number was asked for.
        */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Invoice"
              error={fieldErrors.invoiceNo}
              hint="Attach the invoice itself — there is no number to type"
            >
              <Attach kind="invoice" file={invoiceFile} onPick={setInvoiceFile}>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {invoiceFile ? "" : "No invoice attached"}
                </span>
              </Attach>
            </Field>

            <Field
              label="Reference"
              error={fieldErrors.reference}
              hint={
                refKind === "id"
                  ? "Cheque or bank reference — theirs."
                  : "No number from the bank — attach the slip and it becomes the reference."
              }
            >
              <Attach
                kind="bank_statement"
                file={screenshotFile}
                onPick={setScreenshotFile}
              >
                <Input
                  name="reference"
                  className="num min-w-0 flex-1"
                  placeholder="FT26081200412"
                  defaultValue={transaction?.reference ?? ""}
                />
              </Attach>
            </Field>
          </div>

          {/* The Receipt link box came off on the owner's instruction — the
            invoice and transaction-id paperclips above already carry the
            paper, and a third place to put it was a box people felt obliged
            to fill. Rows that have a link keep it: the field is simply not
            sent, so an edit cannot clear it, and the table still shows the
            open-receipt icon on old rows. */}

          {/*
          What is already filed against this row — which is only a question
          once the row exists. The clips above hand a document to the save;
          this is where one is looked at, or taken off again, and it uploads
          the moment a file is picked because here there is already an id to
          upload against.
        */}
          {editing && transaction ? (
            <Field
              label="Documents on this entry"
              hint="Kept on this company's own server"
            >
              <FileManager
                owner="transaction"
                ownerId={transaction.id}
                kinds={DOCUMENT_KINDS}
                canWrite
                emptyLabel="Nothing attached to this entry."
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
              {usdPrimary ? null : (
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={showFx}
                    onChange={(event) => setShowFx(event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  This arrived as a foreign currency transfer
                </label>
              )}

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
          <Button type="button" variant="secondary" onClick={close}>
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

/**
 * A text box with the paper it refers to clipped beside it.
 *
 * Both numbers on this form point at a document, so the document is asked for
 * in the same breath as the number rather than on a step afterwards. Nothing
 * is uploaded from here — the file is handed up and held until the entry has
 * an id for it to hang on.
 *
 * Deliberately the same control, down to the copy, as the one on the cash-in
 * form: it is the same job on the same pair of fields, and a second shape for
 * it would be a second thing to keep in step. If a third screen ever needs it,
 * it should move into a module of its own rather than be copied again.
 */
function Attach({
  kind,
  file,
  onPick,
  children,
}: {
  kind: DocKind;
  file: File | null;
  onPick: (file: File | null) => void;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  /*
   * Owned here rather than passed in from the form. `Attach` already holds the
   * file, so keeping the preview beside it means none of the six call sites
   * across these three forms has to know about it — and none of them can be
   * the one that forgets.
   */
  const preview = useFilePreview();

  function choose(picked: File | undefined) {
    // Emptied straight away so picking the same file again — after clearing
    // it, or after it was refused — still counts as a change.
    if (inputRef.current) inputRef.current.value = "";
    if (!picked) return;

    /**
     * Refused here as well as by the server, which reads the bytes and has the
     * final say. This exists so the answer arrives while the file is being
     * chosen, rather than after the entry is saved — which is the one moment
     * the message is awkward to act on.
     */
    const allowed: readonly string[] = ALLOWED_MIME_TYPES[kind];
    if (picked.type && !allowed.includes(picked.type)) {
      setRejected("Only JPEG, PNG, WebP and PDF can be stored.");
      return;
    }
    if (picked.size > MAX_FILE_BYTES[kind]) {
      setRejected(
        `That is ${formatFileSize(picked.size)}; the limit is ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
      );
      return;
    }

    setRejected(null);
    onPick(picked);
  }

  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        {children}

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          // Every camera roll and every scanner, as asked. The server keeps a
          // narrower list than this and says so if it has to; `choose` says it
          // first, in the moment.
          accept="image/*,application/pdf"
          onChange={(event) => choose(event.target.files?.[0])}
        />

        {/* A button rather than the file input itself: a bare one renders as a
          browser-styled control too wide to sit beside a text box, and the
          label that would normally dress it cannot nest inside the label
          `Field` already is. */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="size-9 shrink-0 px-0"
          title={`Attach the ${DOCUMENT_NAMES[kind]}`}
          aria-label={`Attach the ${DOCUMENT_NAMES[kind]}`}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
      </span>

      {rejected ? (
        <span className="text-xs text-negative">{rejected}</span>
      ) : file ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{file.name}</span>
          {/*
            Before it is saved, not after. Until this was here the only way to
            check the right scan had been attached was to save the entry and
            then go and open it, which is the wrong order for the one moment
            the mistake is still cheap.
          */}
          <PreviewButton name={file.name} onClick={() => preview.show(file)} />
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label={`Remove ${file.name}`}
            className="shrink-0 cursor-pointer rounded p-0.5 transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ) : null}

      {preview.overlay}
    </span>
  );
}

/**
 * Strips what a person types out of habit. "1,00,000" and "৳1,00,000" are the
 * same figure to a reader and neither is one to divide by a rate.
 */
function plainAmount(value: string): string {
  return value.replace(/[,\s৳$]/g, "").trim();
}
