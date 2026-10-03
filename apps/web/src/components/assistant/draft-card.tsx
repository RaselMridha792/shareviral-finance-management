"use client";

import {
  AI_PAPER_EXTENSIONS,
  formatMoney,
  type AiIntakeReply,
  type AiOpenField,
  type AiTarget,
} from "@finance/shared";
import { Check, CircleAlert, LoaderCircle, Paperclip } from "lucide-react";
import { useRef, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

/** Fields the person should not have to read as a database column name. */
export const FIELD_LABELS: Record<string, string> = {
  txnDate: "Date",
  amount: "Amount",
  description: "What it was for",
  categoryId: "Category",
  categoryName: "Category",
  accountName: "Account",
  accountId: "Account",
  // A transfer between our own accounts: the Money Transfer form's words.
  fromAccountName: "From",
  toAccountName: "To",
  usdAmount: "Amount (USD)",
  usdRate: "USD rate",
  chargeAmount: "Bank charge",
  chargeUsd: "Bank charge (USD)",
  billAmount: "Gross bill",
  withheldTaxAmount: "Tax withheld",
  fullName: "Name",
  joinedOn: "Joined on",
  challanNumber: "Challan number",
  challanDate: "Challan date",
  depositDate: "Deposited on",
  periodYear: "For year",
  periodMonth: "For month",
  name: "Name",
  etin: "e-TIN",
  bin: "BIN",
  type: "Type",

  // People. The batch table shows whatever the file had, so these come up
  // together far more often than they do one at a time on a form.
  engagementType: "Employee or contractor",
  designation: "Designation",
  department: "Department",
  personalEmail: "Personal email",
  workEmail: "Work email",
  phone: "Phone",
  nid: "NID",
  endedOn: "Left on",
  bankName: "Bank",
  bankAccountNumber: "Account number",
  bankRouting: "Routing number",
  walletProvider: "Wallet",
  walletNumber: "Wallet number",
  dateOfBirth: "Date of birth",
  psrStatus: "PSR",
  psrAssessmentYear: "PSR year",

  // The money itself, and who it was with.
  paymentMethod: "Paid by",
  // Named for what the field holds — the other side of the payment — not
  // for the row it is stored against. Same words the import column mapper
  // uses for the same thing, so a person meets one phrase, not two.
  vendorName: "Paid to / received from",
  receiptUrl: "Receipt link",
  originalAmount: "Amount sent",
  originalCurrency: "Currency sent",
  fxRate: "Rate",
  direction: "In or out",
  billingCurrency: "Bills in",
  contactName: "Contact",
  address: "Address",
  notes: "Notes",

  // A plan under AI tools and subscriptions, in the Add subscription form's
  // own words.
  toolName: "Tool",
  planName: "Plan",
  category: "Category",
  costUsd: "Price (USD)",
  costBdt: "Price (BDT)",
  billingCycle: "Billing cycle",
  startDate: "Start date",
  renewalNote: "Renewal note",
  boughtFor: "Bought for",
  loginEmail: "Login email",
  websiteUrl: "Website",
  invoiceNo: "Invoice no.",
  reference: "Reference",
  // A renewal: the plan it is for, and the Renew drawer's note.
  subscriptionName: "Plan",
  note: "Note",
};

/**
 * Where one kind of record calls a field something else.
 *
 * `chargeUsd` is the bank's charge on a payment and the vendor's on a plan;
 * `amount` on a renewal is the taka beside the dollars. One label for both
 * would name the wrong thing on one of the two cards.
 */
const FIELD_LABELS_ON: Partial<Record<AiTarget, Record<string, string>>> = {
  subscription: {
    chargeUsd: "Vendor's charge (USD)",
    accountName: "Paid from",
    // As the plan's row heads them (4 Oct 2026): the columns the owner
    // found reading "N/A".
    boughtFor: "User Department",
    loginEmail: "Login accounts",
    userNames: "User Name",
  },
  subscription_payment: {
    txnDate: "Date it was charged",
    amount: "Amount (BDT)",
    accountName: "Paid from",
  },
};

/**
 * A heading for a field, whether or not anyone has named it.
 *
 * The batch table builds its columns from whatever the rows contain, so a
 * field nobody thought to add above appeared as `engagementType` — a column
 * heading in the shape of a database column, above a table a finance person is
 * being asked to check before it is written. Splitting the camel case is not
 * as good as a chosen word, which is why the map still wins, but it is a great
 * deal better than the raw key and it cannot fall behind a new field.
 */
export function labelFor(key: string, target?: AiTarget | null): string {
  const named =
    (target ? FIELD_LABELS_ON[target]?.[key] : undefined) ?? FIELD_LABELS[key];
  if (named) return named;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The amount, read back — or the raw text if it cannot be parsed.
 *
 * The model writes what it heard, which may carry a separator or a stray
 * character. formatMoney is strict on purpose, so this is where that meets
 * reality: showing the raw string is a fine outcome, throwing inside a render
 * and blanking the screen is not.
 */
function safeMoney(raw: string, currency: "BDT" | "USD" = "BDT"): string {
  const cleaned = raw.replace(/[,\s৳$]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return raw;
  try {
    return formatMoney(cleaned, { currency });
  } catch {
    return raw;
  }
}

/**
 * The figure to read back before saving: the taka on an entry, and on a
 * plan or its renewal the dollars — the figure that is actually billed.
 */
function figureOf(
  draft: Record<string, unknown>,
): { what: string; shown: string } | null {
  if (typeof draft.amount === "string") {
    return { what: "amount", shown: safeMoney(draft.amount) };
  }
  if (typeof draft.costUsd === "string") {
    return { what: "price", shown: safeMoney(draft.costUsd, "USD") };
  }
  if (typeof draft.usdAmount === "string") {
    return { what: "amount", shown: safeMoney(draft.usdAmount, "USD") };
  }
  return null;
}

/** The papers a plan's invoice may be: what the plan's own upload takes. */
const INVOICE_ACCEPT = [".pdf", ...AI_PAPER_EXTENSIONS].join(",");

/**
 * The draft, as an editable form, sitting in the conversation where it was
 * produced.
 *
 * Every value is a real input, not a read-only summary: the person is the one
 * who signs off on the figure, and a value they cannot change is one they
 * cannot correct. Nothing is written until Confirm and save is pressed (A4);
 * the server then checks the boxes again and saves them the way the record's
 * own form does, as this person.
 *
 * The whole form (4 Oct 2026): beside what the Assistant filled in, every
 * field still open shows as an empty box — what Save needs, and what the
 * record's page shows and reads "N/A" without (the owner: "sobgula field
 * somporke ekebarei jigges kore ney"). Each is filled in here or in the chat,
 * or left empty on purpose, before Confirm and save can be pressed: the
 * owner's choice, the same day.
 */
export function DraftCard({
  reply,
  saving,
  edits = {},
  onEdit,
  onConfirm,
  leaveEmpty = {},
  onSkip,
  invoice = null,
  invoiceLost = false,
  attachingInvoice = false,
  onAttachInvoice,
}: {
  reply: AiIntakeReply;
  saving: boolean;
  /**
   * What has been typed over, by field, kept above the card so it survives
   * the card being drawn again in the other view (B4): the floating window
   * expanded to the page, or the page shrunk back to the window.
   */
  edits?: Record<string, string>;
  onEdit?: (field: string, value: string) => void;
  onConfirm: (draft: Record<string, string>) => void;
  /** "Leave empty" pressed or taken back on the card, by field. */
  leaveEmpty?: Record<string, boolean>;
  onSkip?: (field: string, on: boolean) => void;
  /** The plan's invoice, held by the page for Confirm. */
  invoice?: { name: string } | null;
  /** An invoice was read earlier, but its file is no longer held. */
  invoiceLost?: boolean;
  attachingInvoice?: boolean;
  onAttachInvoice?: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const entries = Object.entries(reply.draft).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  const figure = figureOf(reply.draft);

  /*
   * What is still open. An answer from before 4 Oct carries no list; what
   * it still needed is all of it then.
   */
  const open: AiOpenField[] =
    reply.open ??
    reply.missingFields.map((field) => ({
      field,
      label: labelFor(field, reply.target),
      ask: "",
      required: true,
    }));
  const valueOf = (field: string) =>
    (edits[field] ?? String(reply.draft[field] ?? "")).trim();
  const leftEmpty = (field: AiOpenField) =>
    leaveEmpty[field.field] ?? Boolean(field.skipped);

  const empty = open.filter(
    (field) =>
      !field.file &&
      !entries.some(([key]) => key === field.field),
  );
  // A box the page filled itself: an invoice's number read on the card.
  const extra = Object.keys(edits).filter(
    (key) =>
      !entries.some(([filled]) => filled === key) &&
      !open.some((field) => field.field === key),
  );
  const paper: AiOpenField | null =
    open.find((field) => field.file) ??
    (invoice || invoiceLost
      ? {
          field: "invoice",
          label: "Invoice",
          ask: "attach it here, a PDF or a picture",
          required: false,
          file: true,
        }
      : null);

  // In the order they were asked, the invoice where the list has it.
  const pending = [
    ...open.filter((field) => field.file || empty.includes(field)),
    ...(paper && !open.includes(paper) ? [paper] : []),
  ].filter((field) =>
    field.file
      ? !invoice && !leftEmpty(field)
      : !valueOf(field.field) && (field.required || !leftEmpty(field)),
  );
  const ready = pending.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (text) draft[key] = text;
    }
    onConfirm(draft);
  }

  if (!entries.length) return null;

  /** "Leave empty", for a field Save does not need and nobody has filled. */
  const skipButton = (field: AiOpenField) =>
    field.required || !onSkip || (!field.file && valueOf(field.field)) ? null : (
      <button
        type="button"
        aria-pressed={leftEmpty(field)}
        onClick={() => onSkip(field.field, !leftEmpty(field))}
        className={
          leftEmpty(field)
            ? "inline-flex cursor-pointer items-center gap-1 rounded-full bg-(--sv-violet-tint) px-2 py-0.5 text-[11.5px] font-extrabold text-(--sv-violet-ink)"
            : "inline-flex cursor-pointer items-center gap-1 py-0.5 text-[11.5px] font-extrabold text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
        }
      >
        {leftEmpty(field) ? (
          <>
            <Check className="size-3" /> Left empty
          </>
        ) : (
          "Leave empty"
        )}
      </button>
    );

  return (
    // A container, so two columns follow the card's own width rather than
    // the screen's: in the floating window (B4) a wide screen still holds a
    // narrow card.
    <div className="@container rounded-xl border border-border bg-surface shadow-e1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">The draft</h2>
        <p className="text-xs text-muted-foreground">
          {ready
            ? "Check every line, then confirm."
            : // By the page's own headings, the same words as the boxes below,
              // which is where they will go to answer it.
              `Still to answer: ${pending.map((field) => field.label).join(", ")}`}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 @lg:grid-cols-2">
          {entries.map(([key, value]) => (
            <Field
              key={key}
              label={labelFor(key, reply.target)}
              className={
                String(value).length > 60 ? "@lg:col-span-2" : undefined
              }
            >
              {String(value).length > 60 ? (
                <Textarea
                  name={key}
                  defaultValue={edits[key] ?? String(value)}
                  onChange={(event) => onEdit?.(key, event.target.value)}
                  rows={2}
                />
              ) : (
                <Input
                  name={key}
                  defaultValue={edits[key] ?? String(value)}
                  onChange={(event) => onEdit?.(key, event.target.value)}
                  className={
                    key.toLowerCase().includes("amount") ? "col-amount" : ""
                  }
                />
              )}
            </Field>
          ))}

          {extra.map((key) => (
            <Field key={key} label={labelFor(key, reply.target)}>
              <Input
                name={key}
                defaultValue={edits[key]}
                onChange={(event) => onEdit?.(key, event.target.value)}
              />
            </Field>
          ))}

          {/* Open: empty until it is answered, here or in the chat. */}
          {empty.map((field) => (
            <Field
              key={field.field}
              label={field.label}
              required={field.required}
              hint={
                <span
                  data-open-field={field.field}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span>{field.ask}</span>
                  {skipButton(field)}
                </span>
              }
            >
              <Input
                name={field.field}
                defaultValue={edits[field.field] ?? ""}
                placeholder={leftEmpty(field) ? "Left empty" : undefined}
                onChange={(event) => onEdit?.(field.field, event.target.value)}
              />
            </Field>
          ))}

          {/* The invoice is a paper, not a box: attached here or in the chat,
              and uploaded to the plan once the plan is saved. Not a Field:
              a label round a file input opens the picker on any click in it. */}
          {paper ? (
            <div className="flex flex-col gap-1.5" data-open-field="invoice">
              <span className="text-[13px] font-extrabold">{paper.label}</span>
              <input
                ref={picker}
                type="file"
                accept={INVOICE_ACCEPT}
                className="hidden"
                aria-label="Attach the invoice"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onAttachInvoice?.(file);
                  event.target.value = "";
                }}
              />
              <div className="flex min-h-11 flex-wrap items-center gap-2">
                {invoice ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1 text-sm">
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{invoice.name}</span>
                  </span>
                ) : null}
                {onAttachInvoice ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={attachingInvoice}
                    onClick={() => picker.current?.click()}
                  >
                    {attachingInvoice ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                    {invoice ? "Another file" : "Attach the invoice"}
                  </Button>
                ) : null}
              </div>
              <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-(--sv-muted)">
                {invoice
                  ? "Attached to the plan when you confirm."
                  : invoiceLost
                    ? "Read earlier, but the file is not kept in the chat: attach it again."
                    : paper.ask}
                {invoice ? null : skipButton(paper)}
              </span>
            </div>
          ) : null}
        </div>

        {figure ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Read the {figure.what} back before saving:{" "}
              <strong className="num">{figure.shown}</strong>. A misheard figure
              looks exactly like a correct one.
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!ready || saving}
            title={
              ready
                ? undefined
                : "Fill in each empty line, or press Leave empty on it"
            }
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Confirm and save
          </Button>
          {ready ? null : (
            <span className="text-xs text-muted-foreground">
              Answer above, or fill in the empty lines here — Leave empty on
              any you do not have
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
