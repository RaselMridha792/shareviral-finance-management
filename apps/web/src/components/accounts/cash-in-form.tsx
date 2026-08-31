"use client";

import {
  ALLOWED_MIME_TYPES,
  formatFileSize,
  isValidAmount,
  MAX_FILE_BYTES,
  todayInDhaka,
} from "@finance/shared";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

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
import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import {
  ReferenceInput,
  ReferenceKindToggle,
  type ReferenceKind,
} from "@/components/ledger/reference-kind";
import { ledgerApi, type TransactionDto } from "@/lib/ledger";
import { type AccountDto } from "@/lib/masters";
import { fxApi } from "@/lib/reports";
import { PreviewButton, useFilePreview } from "@/components/files/file-preview";

/**
 * The two files a receipt comes with.
 *
 * Stored under the kinds the ledger already uses. The owner calls the second
 * one a transaction screenshot and that is what the button says, but the kind
 * stays `bank_statement`: renaming it would leave every document already filed
 * under it in a category nothing looks in.
 */
type DocKind = "invoice" | "bank_statement";

const DOCUMENT_NAMES: Record<DocKind, string> = {
  invoice: "invoice",
  bank_statement: "transaction screenshot",
};

/**
 * A receipt, in the shape of the sheet it replaces.
 *
 * The owner's spreadsheet has ten columns and this asks for those and no more,
 * plus three the sheet cannot carry: the heading the ledger files it under, and
 * a file beside each of the two reference numbers. The remittance advice's own
 * detail — the sending bank, the account the money left, the SWIFT code — went
 * with the rest. The sheet asks for one Sender, so one Sender is what this asks.
 *
 * Date is the one field here that no column of the sheet asks for. It stays
 * because the API requires it, and because this screen is read a month at a
 * time: an entry dated wrongly is not a wrong date, it is an entry that has
 * vanished out of the month it belongs to.
 *
 * It writes an ordinary money-in transaction. Nothing here bypasses the ledger.
 */
export function CashInForm({
  open,
  transaction,
  accounts,

  onClose,
  onSaved,
}: {
  open: boolean;
  /**
   * The row being corrected, or nothing when one is being recorded.
   *
   * Correcting a cash-in used to open the general ledger drawer, which asks a
   * different set of questions: no sender, no invoice number, no rate read
   * back as you type. So the same row was recorded through one form and fixed
   * through another, and the fields this screen exists for were unreachable
   * the moment they were wrong.
   */
  transaction?: TransactionDto;
  accounts: AccountDto[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const editing = Boolean(transaction);
  /**
   * The rate governs the whole month, so an empty box is the expensive
   * outcome. Prefilled with the last one recorded — almost always today's —
   * and editable, because the day's rate is the entire point of asking.
   */
  const [usdRate, setUsdRate] = useState(transaction?.usdRate ?? "");
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

  /**
   * The two files, picked while the rest is being typed and held here until
   * there is something to hang them on.
   *
   * They cannot go up any earlier: an upload is addressed to a transaction id,
   * and the transaction does not exist until this form is submitted. Holding
   * them is what lets both be chosen in one pass instead of the entry being
   * saved and a second screen handed over.
   */
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);

  /*
   * A transaction id, or only the paper. Seeded from the row being edited: a
   * row that has a number was the first kind, one without was the second —
   * the state is read back rather than stored, so no entry made before this
   * existed has to be migrated into an opinion.
   */
  const [refKind, setRefKind] = useState<ReferenceKind>(
    transaction && !transaction.reference ? "paper" : "id",
  );

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
   * Whether the taka figure is being worked out right now.
   *
   * Only then is the box read-only. Two cases would otherwise be broken by
   * locking it outright, and both are ordinary:
   *
   *   - a LOCAL receipt has no dollars at all, so `derivedAmount` is "" and a
   *     locked box would leave no way to record the amount that arrived;
   *   - EDITING an entry whose stored taka does not equal dollars x rate —
   *     which is what a bank charge looks like — would silently rewrite the
   *     figure to the product the moment the drawer opened.
   *
   * So: dollars and a rate present means the arithmetic owns the box; anything
   * else means the person does.
   */
  const isDerived = derivedAmount !== "";
  const amount = isDerived
    ? derivedAmount
    : amountTyped
      ? typedAmount
      : (transaction?.amount ?? "");
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
   * The saved entry, and the documents that did not make it up with it.
   *
   * Only ever set when an upload failed. The ordinary ending is that the entry
   * saves, the files follow it and the drawer closes — a second step with
   * nothing left to do on it is a step nobody should be shown. But a save that
   * succeeds and an upload that does not is a real outcome, and the honest
   * answer is neither to report the whole save as failed nor to swallow it:
   * the money is recorded, and the file is one button from the row that now
   * exists to take it.
   */
  const [saved, setSaved] = useState<TransactionDto | null>(null);
  const [failed, setFailed] = useState<{ kind: DocKind; reason: string }[]>([]);

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
        const last = rates.items[0]?.rate ?? null;
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
  // Correcting: the row's own account, and the field is locked — see the
  // comment on the submit. Recording: the first account, as before.
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? accounts[0]?.id ?? "",
  );
  /*
   * The landing account's own choice. On a USD-primary account the dollars
   * are not optional decoration — they are the figure the account thinks in,
   * so the box turns required and loses its "blank for a local receipt" out.
   */
  const usdPrimary =
    accounts.find((candidate) => candidate.id === accountId)?.currency ===
    "USD";

  /**
   * Closing empties what the drawer would not.
   *
   * Most of this form is uncontrolled and unmounts with the panel, so it comes
   * back blank on its own. The figures and the two picked files would not, and
   * a reopened form still carrying the last transfer's amount is how the same
   * money gets recorded twice. The rate is deliberately kept — it is prefilled
   * from the last one recorded anyway.
   */
  function close() {
    setTypedAmount("");
    setUsdSent("");
    setAmountTyped(false);
    setInvoiceFiles([]);
    setScreenshotFiles([]);
    /**
     * Anything attached from the recovery panel landed after the table was
     * last refreshed, so ask for it again on the way out — otherwise the row
     * whose invoice was just attached still reads as having nothing on it.
     */
    if (saved) void onSaved();
    setSaved(null);
    setFailed([]);
    onClose();
  }

  /**
   * Every paper on every clip, flattened, in the order they appear.
   *
   * A clip holds a list now, so this is a flatMap rather than a filter — and
   * the upload loop below already took a list, which is why sending three
   * invoices costs nothing new: it sends them one at a time and reports each
   * failure separately, exactly as it did for two.
   */
  function chosen(): { kind: DocKind; file: File }[] {
    return [
      ...invoiceFiles.map((file) => ({ kind: "invoice" as const, file })),
      ...screenshotFiles.map((file) => ({
        kind: "bank_statement" as const,
        file,
      })),
    ];
  }

  /**
   * Send whatever was picked, now that there is a row to address it to.
   *
   * One at a time, and never throwing. A failed invoice must not stop the
   * screenshot from going up, and neither of them may surface as the save
   * having failed — by the time this runs the money is already in the ledger.
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
      const payload = {
        txnDate: String(data.get("txnDate")),
        // The bank's number for the transfer, as against `invoiceNo`, which is
        // ours. The sheet calls this one the Transaction ID.
        reference: text("reference"),
        invoiceNo: text("invoiceNo"),
        description: String(data.get("description")),
        accountId: String(data.get("accountId")),
        amount: String(data.get("amount")),
        usdRate: String(data.get("usdRate")).trim(),
        // Blank on a local receipt, and then this row is exactly what it was
        // before: an ordinary money-in with a reference rate on it. Given, the
        // API fills the conversion columns the funding report reads.
        usdSent: plainAmount(String(data.get("usdSent") ?? "")) || undefined,
        /**
         * The sheet's Sender is an entity — "ShareViral Corp" — which is the
         * name the sending account is held in, so `senderAccountName` and not
         * `senderBankName`, which is where the money left from rather than who
         * sent it. The other three sender columns are simply not sent; rows
         * written before this form was cut down keep the values they were
         * given.
         */
        senderAccountName: text("senderAccountName"),
        // Money from abroad arrives one way. Offering a choice here would only
        // create a row that says a wire was paid in cash.
        paymentMethod: "bank_transfer" as const,
        notes: text("notes"),
      };

      /*
       * Correcting sends only what changed shape allows, and never re-runs the
       * conversion columns: `usdSent` and the realised rate belong to the day
       * the money landed, and an edit weeks later must not restate them.
       */
      const row = transaction
        ? await ledgerApi.update(transaction.id, {
            txnDate: payload.txnDate,
            reference: payload.reference,
            invoiceNo: payload.invoiceNo,
            description: payload.description,
            amount: payload.amount,
            senderAccountName: payload.senderAccountName,
            notes: payload.notes,
            // No `accountId`: the ledger will not let an edit move money
            // between two balances, and it is right not to. Landing it in the
            // wrong account is fixed by voiding the row and recording it
            // again, which leaves a trail.
          })
        : await ledgerApi.recordCashIn(payload);

      const picked = chosen().length;
      const failures = await attach(row.id);

      // Before either ending: the row is in the table now, and how many
      // documents hang on it is part of what that table draws.
      await onSaved();

      if (failures.length === 0) {
        toast.show(
          picked > 0
            ? "Transfer recorded, documents attached."
            : "Transfer recorded. Nothing attached to it.",
        );
        close();
        return;
      }

      toast.show(
        `Saved as ${row.refNo}, but a document did not upload.`,
        "error",
      );
      setFailed(failures);
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
      title="Add cash"
      description="The columns of the receipts sheet, and the two files behind them."
    >
      {saved ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-negative/10 px-4 py-3 text-sm">
            <span className="font-medium">Recorded as</span>{" "}
            <span className="num">{saved.refNo}</span> — the entry is saved and
            the table already has it. What did not go up is the{" "}
            {failed.map((slot) => DOCUMENT_NAMES[slot.kind]).join(" and the ")}:{" "}
            {failed.map((slot) => slot.reason).join(" ")} Attaching it here
            needs nothing typed again.
          </p>

          <FileManager
            owner="transaction"
            ownerId={saved.id}
            kinds={failed.map((slot) => slot.kind)}
            canWrite
            emptyLabel="Nothing attached yet."
          />

          <p className="text-xs text-muted-foreground">
            Leaving now keeps the entry and loses only the file. The
            transactions table marks rows with nothing attached, so this one can
            be found and finished later.
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
                defaultValue={transaction?.txnDate ?? todayInDhaka()}
              />
            </Field>
          </div>

          {/* Two reference numbers, side by side because the paperwork has both
            and they answer different questions: the invoice number is ours —
            what the transfer was against — and the transaction id is the
            bank's, what to quote when asking them about it. Each carries the
            paper it refers to on the clip beside it.

            Neither is required, on the owner's instruction. Money arrives
            without an invoice and banks do not always give a number, and a
            box that refuses the entry is how a real receipt goes unrecorded —
            or gets recorded with a made-up number, which is worse than blank
            because it reads as a fact. The contract has always allowed both
            to be empty; this screen was the only thing insisting. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Invoice"
              error={fieldErrors.invoiceNo}
              hint="Attach the invoice itself — there is no number to type"
            >
              <Attach
                kind="invoice"
                files={invoiceFiles}
                onPick={setInvoiceFiles}
              >
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {invoiceFiles.length ? "" : "No invoice attached"}
                </span>
              </Attach>
            </Field>

            <Field
              label="Reference"
              error={fieldErrors.reference}
              hint="The bank's own number, if it gave one — otherwise attach the slip"
            >
              <Attach
                kind="bank_statement"
                files={screenshotFiles}
                onPick={setScreenshotFiles}
              >
                <Input
                  name="reference"
                  defaultValue={transaction?.reference ?? undefined}
                  className="num min-w-0 flex-1"
                  placeholder="FT26081200412"
                />
              </Attach>
            </Field>
          </div>

          <Field label="Description" required error={fieldErrors.description}>
            <Input
              name="description"
              defaultValue={transaction?.description}
              required
              placeholder="August funding from ShareViral Corp"
            />
          </Field>

          {/*
            Which account it landed in, FIRST.

            It used to sit below the amounts, and the owner's objection is
            arithmetic rather than taste: this choice decides whether the form
            asks for dollars at all — a USD-primary account puts the dollar
            boxes in front — so it cannot be the last question on the page. A
            control whose answer changes the questions above it has to come
            before them.
          */}
          {/* Our side, not the sender's. The advice does not decide which of
            our accounts a transfer lands in, and it can land in any of them. */}
          <Field
            label="Received Bank Name"
            required
            error={fieldErrors.accountId}
            hint={
              editing
                ? "Fixed once recorded. Landing it in the wrong account is corrected by voiding this entry and recording it again, which leaves a trail — an edit that moved money between two balances would not."
                : "The account of ours the money landed in"
            }
          >
            <SearchableSelect
              name="accountId"
              value={accountId}
              onChange={setAccountId}
              disabled={editing}
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

          {/* The dollar side and the rate first, then the taka they come to.
            The sheet reads taka-first, but this box fills itself in from the
            two beside it, and an answer printed above its own inputs is a box
            that appears to change on its own. The rate is asked at the only
            moment anybody knows it: it is read back all month, since every
            taka figure is shown in dollars at the rate the month's funding
            arrived at, and a rate looked up later is the rate on the day of
            the lookup. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Amount (USD)"
              required={usdPrimary}
              error={fieldErrors.usdSent}
              hint={
                usdPrimary
                  ? "This account's primary currency — the figure the advice states."
                  : "What the sender sent. Blank for a local receipt."
              }
            >
              <MoneyInput
                name="usdSent"
                required={usdPrimary}
                placeholder="0.00"
                value={usdSent}
                onChange={(event) => setUsdSent(event.target.value)}
              />
            </Field>

            <Field
              label="Rate"
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

          {/*
            Worked out, and not typed over.

            The owner: "je field ta auto fill hobe rate bosanor por oi field ta
            edit kora jawa ucit na karon oita calculation korei to asteche" —
            and he is right. The box said "Worked out from the two above" and
            then accepted typing, so a figure could sit there disagreeing with
            the two numbers printed beside it, and nothing on the screen would
            say which was true.

            It is read-only now. The dollars and the rate are the two facts;
            the taka is what they come to. If the bank credited something else,
            the honest edit is the RATE — that is what the difference actually
            was — and the working underneath shows it.
          */}
          <Field
            label="Amount (BDT)"
            required
            error={fieldErrors.amount}
            hint={
              isDerived
                ? "Worked out from the dollars and the rate above. Change the rate if the bank credited something else."
                : "What landed, in taka"
            }
          >
            <MoneyInput
              name="amount"
              required
              placeholder="0.00"
              value={amount}
              readOnly={isDerived}
              tabIndex={isDerived ? -1 : undefined}
              aria-readonly={isDerived || undefined}
              className={
                isDerived
                  ? "cursor-not-allowed text-muted-foreground"
                  : undefined
              }
              onChange={(event) => {
                if (isDerived) return;
                setTypedAmount(event.target.value);
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
          ) : null}

          {/* Optional, as every sender field on this form has always been. The
            sheet fills it in every time, but a receipt whose sender nobody
            wrote down is still a receipt, and refusing it would lose the
            amount along with the name. */}
          <Field label="Sender" error={fieldErrors.senderAccountName}>
            <Input
              name="senderAccountName"
              defaultValue={transaction?.senderAccountName ?? undefined}
              placeholder="ShareViral Corp"
            />
          </Field>

          <Field label="Note" error={fieldErrors.notes}>
            <Textarea
              name="notes"
              defaultValue={transaction?.notes ?? undefined}
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
      )}

      {/* The footer belongs to the form step only — the recovery panel carries
          its own Done, and a Cancel beside an entry that is already saved
          would read as if it could undo it. */}
      {saved ? null : (
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
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
 * A text box with the paper it refers to clipped beside it.
 *
 * Both numbers on this form point at a document, so the document is asked for
 * in the same breath as the number rather than on a step afterwards. Nothing
 * is uploaded from here — the file is handed up and held until the entry has
 * an id for it to hang on.
 */
function Attach({
  kind,
  files,
  onPick,
  children,
}: {
  kind: DocKind;
  /**
   * Everything clipped here, not one thing.
   *
   * The owner: "multiple documents upload korar option thakte hobe". An
   * invoice can be two pages photographed separately, a bank slip can be the
   * confirmation and the statement line; the form used to keep whichever was
   * chosen last and silently drop the other.
   */
  files: File[];
  onPick: (files: File[]) => void;
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

  /**
   * Everything just chosen, judged together and appended in one go.
   *
   * One pass rather than a loop of single adds, and that is not tidiness: each
   * `onPick` is a setState the parent has not re-rendered from yet, so three
   * separate calls would each build on the ORIGINAL list and only the last
   * would survive — the very bug this change exists to fix, reintroduced one
   * level down. A ref would also work and the lint rule rightly refuses it:
   * writing a ref during render is not something to reach for when the honest
   * shape is simply to decide once.
   */
  function choose(chosenFiles: File[]) {
    // Emptied straight away so picking the same file again — after clearing
    // it, or after it was refused — still counts as a change.
    if (inputRef.current) inputRef.current.value = "";
    if (chosenFiles.length === 0) return;

    const additions: File[] = [];
    const same = (a: File, b: File) => a.name === b.name && a.size === b.size;

    for (const picked of chosenFiles) {
      /*
       * The same file twice is almost always a second click rather than a
       * second page, and a duplicate upload is not undone by removing one of
       * them. Checked against what is already attached AND against what this
       * same choice is adding.
       */
      if (
        files.some((f) => same(f, picked)) ||
        additions.some((f) => same(f, picked))
      ) {
        setRejected("That one is already attached.");
        continue;
      }

      /**
       * Refused here as well as by the server, which reads the bytes and has
       * the final say. This exists so the answer arrives while the file is
       * being chosen, rather than after the entry is saved — which is the one
       * moment the message is awkward to act on.
       */
      const allowed: readonly string[] = ALLOWED_MIME_TYPES[kind];
      if (picked.type && !allowed.includes(picked.type)) {
        setRejected("Only JPEG, PNG, WebP and PDF can be stored.");
        continue;
      }
      if (picked.size > MAX_FILE_BYTES[kind]) {
        setRejected(
          `That is ${formatFileSize(picked.size)}; the limit is ${formatFileSize(MAX_FILE_BYTES[kind])}.`,
        );
        continue;
      }

      additions.push(picked);
    }

    if (additions.length > 0) {
      setRejected(null);
      onPick([...files, ...additions]);
    }
  }

  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        {children}

        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          // Every camera roll and every scanner, as asked. The server keeps a
          // narrower list than this and says so if it has to; `choose` says it
          // first, in the moment.
          accept="image/*,application/pdf"
          /*
           * Every file the picker returned, not the first. The input is
           * `multiple`, so choosing three pages in one go has to attach three
           * — taking [0] made the extra choice look accepted and drop it.
           */
          onChange={(event) => choose([...(event.target.files ?? [])])}
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
      ) : null}

      {/*
        One line per paper, each with its own eye and its own cross. The eye
        opens the WHOLE set from that one — clicking the second of three starts
        the slider on the second — because somebody checking their attachments
        is checking all of them, not one.
      */}
      {files.map((one, index) => (
        <span
          key={`${one.name}-${one.size}-${index}`}
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="truncate">{one.name}</span>
          <PreviewButton
            name={one.name}
            count={files.length}
            onClick={() => preview.show(files, index)}
          />
          <button
            type="button"
            onClick={() => onPick(files.filter((_, i) => i !== index))}
            aria-label={`Remove ${one.name}`}
            className="shrink-0 cursor-pointer rounded p-0.5 transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}

      {preview.overlay}
    </span>
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

/** The stored column is "118.750000"; a person reads "118.75". */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}
