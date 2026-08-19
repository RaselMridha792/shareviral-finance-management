"use client";

import { formatMoney, type AiIntakeReply } from "@finance/shared";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { FormEvent } from "react";

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
export function labelFor(key: string): string {
  const named = FIELD_LABELS[key];
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
function safeMoney(raw: string): string {
  const cleaned = raw.replace(/[,\s৳$]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return raw;
  try {
    return formatMoney(cleaned);
  } catch {
    return raw;
  }
}

/**
 * The draft, as an editable form, sitting in the conversation where it was
 * produced.
 *
 * Every value is a real input, not a read-only summary: the person is the one
 * who signs off on the figure, and a value they cannot change is one they
 * cannot correct. Nothing is written until Save is pressed, and pressing it
 * calls the same endpoint the manual form calls.
 */
export function DraftCard({
  reply,
  saving,
  onConfirm,
}: {
  reply: AiIntakeReply;
  saving: boolean;
  onConfirm: (draft: Record<string, unknown>) => void;
}) {
  const ready = reply.missingFields.length === 0;
  const entries = Object.entries(reply.draft).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const draft: Record<string, unknown> = {};
    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (text) draft[key] = text;
    }
    onConfirm(draft);
  }

  if (!entries.length) return null;

  return (
    <div className="rounded-xl border border-border bg-surface shadow-e1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">The draft</h2>
        <p className="text-xs text-muted-foreground">
          {ready
            ? "Check every line, then save."
            : // The model names what it still needs by the schema key, so this
              // read "Still needed: vendorName" — the database talking, in the
              // one line asking a person for help. Same words as the labels on
              // the boxes below, which is where they will go to answer it.
              `Still needed: ${reply.missingFields.map(labelFor).join(", ")}`}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {entries.map(([key, value]) => (
            <Field
              key={key}
              label={labelFor(key)}
              className={
                String(value).length > 60 ? "sm:col-span-2" : undefined
              }
            >
              {String(value).length > 60 ? (
                <Textarea name={key} defaultValue={String(value)} rows={2} />
              ) : (
                <Input
                  name={key}
                  defaultValue={String(value)}
                  className={
                    key.toLowerCase().includes("amount") ? "col-amount" : ""
                  }
                />
              )}
            </Field>
          ))}
        </div>

        {typeof reply.draft.amount === "string" ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Read the amount back before saving:{" "}
              <strong className="num">
                {safeMoney(String(reply.draft.amount))}
              </strong>
              . A misheard figure looks exactly like a correct one.
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            disabled={!ready || saving}
            title={ready ? undefined : "Something is still missing"}
          >
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Save it
          </Button>
          {ready ? null : (
            <span className="text-xs text-muted-foreground">
              Answer the question above first
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
