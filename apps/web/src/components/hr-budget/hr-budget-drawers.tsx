"use client";

import { formatMoney, todayInDhaka } from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";

import { AttachClip } from "@/components/files/attach-clip";
import { FileManager } from "@/components/files/file-manager";
import { CategorySelect } from "@/components/ledger/category-select";
import { useUsdRate } from "@/components/money/rate-provider";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { ApiError, uploadTransactionFile } from "@/lib/api-client";
import {
  hrBudgetApi,
  type Decision,
  type HrBudgetSpendDto,
} from "@/lib/hr-budget";
import type { AccountDto, CategoryNode } from "@/lib/masters";

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("That did not go through. Try again.");
      }
    } finally {
      setPending(false);
    }
  }
  return { pending, error, fieldErrors, run };
}

function Footer({
  form,
  pending,
  label,
  danger = false,
  onClose,
}: {
  form: string;
  pending: boolean;
  label: string;
  danger?: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="submit"
        form={form}
        variant={danger ? "danger" : "primary"}
        disabled={pending}
        data-hrb-submit
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {label}
      </Button>
    </>
  );
}

const WORDS: Record<Decision, { title: string; label: string }> = {
  approved: { title: "Approve", label: "Approve" },
  refused: { title: "Refuse", label: "Refuse" },
  received: { title: "Put back to waiting", label: "Put back" },
};

/**
 * Approve, refuse, or put a decision back — for a budget or a spend. A
 * refusal says why, because the HR portal shows the note to HR; an approval
 * may say something too.
 */
export function DecisionDrawer({
  kind,
  id,
  decision,
  summary,
  onClose,
  onDone,
}: {
  kind: "period" | "spend";
  id: string;
  decision: Decision;
  /** What it is, in a line: "Hiring, 01/09–30/11 · ৳5,00,000". */
  summary: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { pending, error, fieldErrors, run } = useSubmit();
  const words = WORDS[decision];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note =
      String(new FormData(event.currentTarget).get("note") ?? "").trim() ||
      null;
    await run(async () => {
      if (kind === "period") await hrBudgetApi.decidePeriod(id, decision, note);
      else await hrBudgetApi.decideSpend(id, decision, note);
      onDone();
    });
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${words.title} — ${kind === "period" ? "budget" : "spend"}`}
      description={summary}
      footer={
        <Footer
          form="hrb-decision"
          pending={pending}
          label={words.label}
          danger={decision === "refused"}
          onClose={onClose}
        />
      }
    >
      <form
        id="hrb-decision"
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {decision === "received" ? (
          <p className="text-[13.5px] text-(--sv-muted)">
            It goes back to waiting. HR can send it again with changes, and
            finance decides it afresh.
          </p>
        ) : (
          <Field
            label={decision === "refused" ? "Why it is refused" : "Note"}
            required={decision === "refused"}
            error={fieldErrors.note}
            hint="HR sees this"
          >
            <Textarea
              name="note"
              rows={3}
              maxLength={500}
              required={decision === "refused"}
              data-hrb-field="note"
            />
          </Field>
        )}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
          >
            {error}
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}

/** The two papers a payment carries, under the ledger's own kinds. */
type PaperKind = "invoice" | "bank_statement";

const PAPER_NAMES: Record<PaperKind, string> = {
  invoice: "invoice or receipt",
  bank_statement: "transaction screenshot",
};

/**
 * Paying an approved spend: the expense it becomes in the books — which
 * account it leaves, under which heading, on which day, at which rate. The
 * ledger's own rules hold: a closed month, or an account that would go below
 * zero, is refused in words.
 *
 * And the two papers every other money form asks for (#122) — the owner:
 * *"jokhon to pay korbe tokhono reference and invoice upload korar option dite
 * hobe"*. Attached, never typed, as on the ledger's own form: the invoice,
 * and the bank's slip as the Reference. They go up once the expense exists,
 * filed on it, so Other expenses shows them in its Invoice and Reference
 * columns like any entry's. A paper that fails to go up does not undo the
 * payment — the drawer says so and offers the upload again.
 */
export function PayDrawer({
  spend,
  accounts,
  categories,
  onClose,
  onDone,
}: {
  spend: HrBudgetSpendDto;
  accounts: AccountDto[];
  categories: CategoryNode[];
  onClose: () => void;
  onDone: () => void;
}) {
  const settings = useSettings();
  const rate = useUsdRate();
  const toast = useToast();
  const { pending, error, fieldErrors, run } = useSubmit();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [slipFiles, setSlipFiles] = useState<File[]>([]);
  /* Set once the money is in the books and a paper did not go up after it. */
  const [paid, setPaid] = useState<{
    transactionId: string;
    transactionRef: string;
    failed: { kind: PaperKind; reason: string }[];
  } | null>(null);
  const usable = categories.filter(
    (group) => group.kind === "out" || group.kind === "both",
  );

  /** One at a time, never throwing: the payment is already recorded. */
  async function attach(transactionId: string) {
    const failed: { kind: PaperKind; reason: string }[] = [];
    const papers = [
      ...invoiceFiles.map((file) => ({ kind: "invoice" as const, file })),
      ...slipFiles.map((file) => ({ kind: "bank_statement" as const, file })),
    ];
    for (const paper of papers) {
      try {
        await uploadTransactionFile(transactionId, paper.file, paper.kind);
      } catch (caught) {
        failed.push({
          kind: paper.kind,
          reason:
            caught instanceof ApiError
              ? caught.message
              : "The upload did not go through.",
        });
      }
    }
    return failed;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    await run(async () => {
      const entry = await hrBudgetApi.paySpend(spend.id, {
        accountId,
        categoryId,
        txnDate: text("txnDate"),
        usdRate: text("usdRate"),
        description: text("description"),
        notes: text("notes") || null,
      });
      const failed = await attach(entry.transactionId);
      if (failed.length > 0) {
        setPaid({ ...entry, failed });
        return;
      }
      toast.show(
        invoiceFiles.length + slipFiles.length > 0
          ? `Paid as ${entry.transactionRef}, papers attached.`
          : `Paid as ${entry.transactionRef}.`,
        "success",
      );
      onDone();
    });
  }

  if (paid) {
    /* The spend is paid now, so closing — either way — reloads the list. */
    return (
      <Drawer
        open
        onClose={onDone}
        title="Paid — a paper did not go up"
        description={`${formatMoney(spend.amount, { format: settings.numberFormat })} — ${spend.purpose}.`}
        footer={
          <Button type="button" variant="primary" onClick={onDone}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4" data-hrb-paid>
          <p className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm">
            <span className="font-medium">Recorded as</span>{" "}
            <span className="num">{paid.transactionRef}</span> — the payment is
            in the books. What did not go up is the{" "}
            {paid.failed.map((one) => PAPER_NAMES[one.kind]).join(" and the ")}:{" "}
            {paid.failed.map((one) => one.reason).join(" ")} Attach it here;
            nothing needs typing again.
          </p>
          <FileManager
            owner="transaction"
            ownerId={paid.transactionId}
            kinds={[...new Set(paid.failed.map((one) => one.kind))]}
            canWrite
            emptyLabel="Nothing attached yet."
          />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Pay this spend"
      description={`${formatMoney(spend.amount, { format: settings.numberFormat })} — ${spend.purpose}. It is written into the books as an expense.`}
      footer={
        <Footer
          form="hrb-pay"
          pending={pending}
          label="Pay and record"
          onClose={onClose}
        />
      }
    >
      <form id="hrb-pay" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Paid from" required error={fieldErrors.accountId}>
          <Select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            data-hrb-field="account"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expense heading" required error={fieldErrors.categoryId}>
          <CategorySelect
            name="categoryId"
            value={categoryId}
            onChange={setCategoryId}
            categories={usable}
            kind="out"
            invalid={Boolean(fieldErrors.categoryId?.length)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date" required error={fieldErrors.txnDate}>
            <DateInput
              name="txnDate"
              required
              defaultValue={todayInDhaka()}
              data-hrb-field="date"
            />
          </Field>
          <Field
            label="USD rate"
            required
            error={fieldErrors.usdRate}
            hint="Taka for one dollar, today"
          >
            <Input
              name="usdRate"
              required
              inputMode="decimal"
              className="col-amount"
              defaultValue={rate ? rate.toFixed(2) : ""}
              data-hrb-field="rate"
            />
          </Field>
        </div>
        <Field label="Description" required error={fieldErrors.description}>
          <Input
            name="description"
            required
            maxLength={300}
            defaultValue={`HR: ${spend.purpose}`.slice(0, 300)}
            data-hrb-field="description"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Invoice"
            hint="Attach the invoice itself — there is no number to type"
          >
            <AttachClip
              kind="invoice"
              name={PAPER_NAMES.invoice}
              files={invoiceFiles}
              onPick={setInvoiceFiles}
              emptyLabel="No invoice attached"
            />
          </Field>
          <Field
            label="Reference"
            hint="Attach the bank's slip — there is no number to type"
          >
            <AttachClip
              kind="bank_statement"
              name={PAPER_NAMES.bank_statement}
              files={slipFiles}
              onPick={setSlipFiles}
              emptyLabel="No reference attached"
            />
          </Field>
        </div>
        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea name="notes" rows={2} maxLength={1000} />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
            data-hrb-error
          >
            {error}
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}
