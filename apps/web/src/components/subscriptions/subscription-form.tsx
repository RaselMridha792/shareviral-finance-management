"use client";

import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CATEGORY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  costsAgree,
  deriveCost,
  nextRenewalAfter,
  todayInDhaka,
  type BillingCycle,
  type AccountType,
  type PaymentMethod,
  type SubscriptionCategory,
  type SubscriptionStatus,
} from "@finance/shared";
import { Paperclip, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  DateInput,
  Field,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from "@/components/ui/field";
import { CategorySelect } from "@/components/ledger/category-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import type { TeamMemberDto } from "@/lib/payroll";
import { PreviewButton, useFilePreview } from "@/components/files/file-preview";
import { subscriptionsApi as payApi } from "@/lib/api-client";
import {
  subscriptionsApi,
  uploadSubscriptionFile,
  type SubscriptionDto,
} from "@/lib/subscriptions";

/**
 * What the chosen account's type suggests the method is.
 *
 * The two controls were once merged into one account picker and the method
 * was derived. The owner unmerged them — "Payment Method" is a method (card,
 * bank transfer…) and "Account/Card" names which account pays — so the method
 * is typed rather than inferred. This map remains only as a convenience: when
 * somebody picks an account without having touched the method, the obvious
 * answer is pre-filled, and stays fully editable.
 */
function methodSuggestedBy(
  accounts: AccountDto[],
  accountId: string,
): PaymentMethod | null {
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) return null;
  const byType: Record<AccountType, PaymentMethod> = {
    bank: "bank_transfer",
    cash: "cash",
    mobile_wallet: "mobile_banking",
    card: "card",
  };
  return byType[account.type];
}

/**
 * Adding or changing one plan.
 *
 * The money is the part worth reading. All three of the dollar price, the taka
 * price and the rate are stored, because this company's bills arrive in both —
 * but a form that accepted three independent numbers is exactly how the Cash
 * In sheet came to hold a row whose rate disagrees with its own amounts by
 * ৳27,612, with nothing in the file to say which of the three is wrong. So the
 * third is derived from the two that were typed, and typing over a derived one
 * re-derives the other rather than letting the triple drift apart.
 */
/**
 * A text box with the paper it refers to on a clip beside it.
 *
 * The same shape the transaction and cash-in forms use, because it is the same
 * question: a number is a pointer to a document, and asking for the number
 * without offering to attach the document is how a register fills with
 * references to paper nobody can find.
 */
function Clip({
  picker,
  file,
  onPick,
  label,
  children,
}: {
  picker: React.RefObject<HTMLInputElement | null>;
  file: File | null;
  onPick: (next: File | null) => void;
  label: string;
  children: React.ReactNode;
}) {
  const preview = useFilePreview();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {children}
        <input
          ref={picker}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(event) => {
            onPick(event.target.files?.[0] ?? null);
            // Cleared so picking the same file twice still fires.
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => picker.current?.click()}
          title={label}
          aria-label={label}
          className="shrink-0 cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          <Paperclip className="size-4" />
        </button>
      </div>
      {file ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {/* The name reads as content, not as a caption — the same change
              the other three attach helpers got, so the four screens do not
              drift. */}
          <span className="truncate font-medium text-foreground">
            {file.name}
          </span>
          {/*
            The invoice for a subscription is usually a screenshot, and one
            screenshot looks much like another in a folder. Being able to open
            it here is the difference between attaching the right month's and
            finding out later.
          */}
          <PreviewButton name={file.name} onClick={() => preview.show(file)} />
        </span>
      ) : null}

      {preview.overlay}
    </div>
  );
}

export function SubscriptionForm({
  subscription,
  toolNames,
  accounts,
  categories,
  members,
  open,
  onClose,
  onSaved,
}: {
  subscription?: SubscriptionDto;
  /** Every tool name already on the list behind this drawer — see below. */
  toolNames: string[];
  accounts: AccountDto[];
  /** The spending side of the tree, for the heading the first payment lands
      under. The whole tree is passed; the picker takes the `out` side. */
  categories: CategoryNode[];
  members: TeamMemberDto[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(subscription);

  /**
   * Typed, not picked.
   *
   * The owner asked for a name field rather than a dropdown, and they are
   * right about the use: a tool is bought and then entered, so the name is
   * already known and hunting for it in a list is work the form invented.
   *
   * There is nothing behind it any more either. The name was looked up in
   * `vendors` and a row created there when it was new — a company minted from
   * a text box, which is what the owner threw out. What the plan is for is a
   * name, and the name is now all the register keeps of it.
   */
  const [toolName, setToolName] = useState(subscription?.toolName ?? "");

  /*
   * There is no plan-screenshot state here any more.
   *
   * The owner, looking at this drawer: "Ai and subscription er ekhane tools
   * name er paser upload option ta soriye daw" — the paperclip that sat
   * against the Tool name box comes off. Its file state, its hidden input's
   * ref and the preview hook that opened the chosen image came off with it,
   * because a picker no button can reach is a field that still runs, still
   * holds a file and still uploads it, with nothing on screen to say so.
   *
   * The screenshot itself is NOT gone from the app: `subscription_screenshot`
   * is still uploaded, replaced and deleted by ScreenshotDialog, which opens
   * from the small picture beside a tool's name on the register. That button
   * is drawn only when `row.screenshotFileId` is set (subscription-columns
   * .tsx), so with this clip removed a plan that has never had a screenshot
   * has no route left to a first one. Written down here rather than left for
   * a later reader to rediscover as a bug — see the two notes at the foot of
   * this drawer, which still send somebody to the list to attach one.
   */

  /**
   * The paperwork: chosen while typing, posted once the row exists. A file
   * needs the subscription's id, which does not exist until the save returns,
   * and that is the only reason it is not uploaded at the moment it is picked.
   * (This paragraph used to say "on the same terms as the screenshot" and
   * lean on the block above it for the reason; the screenshot's clip has since
   * been taken off this drawer, so the reason is spelled out here instead of
   * pointing at something no longer in the file.)
   *
   * Two numbers because the paperwork has two — our bill, and what the bank
   * calls the charge — and each gets the paper it refers to on the clip beside
   * it, the way every other money form in this app asks for them.
   */
  const [websiteUrl, setWebsiteUrl] = useState(subscription?.websiteUrl ?? "");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const invoicePicker = useRef<HTMLInputElement>(null);
  /*
   * Read, never written. The box that set it is gone — a reference is attached
   * now — but the value a plan already carries has to keep being sent, or
   * editing anything else on the plan would quietly erase the bank's number
   * somebody recorded before this change.
   */
  const [reference] = useState(subscription?.reference ?? "");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  /*
   * Which expense heading the charge lands under.
   *
   * New, and it is here because adding a plan now takes the money out. The
   * owner: "ami already add subscription er somoy tools er dam koto oita likhe
   * felchi ... ekhane jate price tai perfectly kaj kore and account theke jeno
   * taka kate properly hiseb hoy."
   *
   * The ledger refuses an expense with no heading and it is right to: an
   * uncategorised entry appears on no Expenses screen, which is the very
   * complaint being answered. A plan's own category — "AI Tool", "Hosting" —
   * is this register's vocabulary, not the company's expense headings, so
   * there is nothing here to derive it from.
   */
  const [categoryId, setCategoryId] = useState("");
  /*
   * A transaction id, or only the paper. Read back from the plan being
   * edited rather than stored — see components/ledger/reference-kind.tsx.
   * The controlled `reference` is cleared when the choice turns to paper, so
   * a number typed and then abandoned does not get saved behind a hidden box.
   */
  const referencePicker = useRef<HTMLInputElement>(null);
  const [planName, setPlanName] = useState(subscription?.planName ?? "");
  const [category, setCategory] = useState<SubscriptionCategory>(
    subscription?.category ?? "ai_tool",
  );
  const [status, setStatus] = useState<SubscriptionStatus>(
    subscription?.status ?? "active",
  );

  const [costUsd, setCostUsd] = useState(subscription?.costUsd ?? "");
  const [costBdt, setCostBdt] = useState(subscription?.costBdt ?? "");
  const [usdRate, setUsdRate] = useState(subscription?.usdRate ?? "");

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    subscription?.billingCycle ?? "monthly",
  );
  const [startDate, setStartDate] = useState(subscription?.startDate ?? "");
  /*
   * No renewal-date state, because the form no longer asks for one.
   *
   * The owner: "If select Monthly hoy tahole renews date auto calculation hobe
   * ekhane notun kore renewal date dite hobena oi field ta remove korte hobe."
   * The server derives it from the start date and the cycle. What is shown
   * below is that same derivation, so somebody sees the date they are choosing
   * rather than being told about it afterwards.
   */
  /*
   * Guarded, because a new plan has no start date until somebody types one.
   * `nextRenewalAfter("")` reaches `parseIsoDate("")` and throws, which took
   * the whole drawer down — it rendered nothing at all, and the only symptom
   * was an "Add a subscription" button that appeared to do nothing.
   */
  const derivedRenewal = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? nextRenewalAfter(startDate, billingCycle, todayInDhaka())
    : null;

  const [accountId, setAccountId] = useState(subscription?.accountId ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    (subscription?.paymentMethod as PaymentMethod) ?? "card",
  );
  /** Only an untouched method follows the account pick. */
  const [methodTouched, setMethodTouched] = useState(Boolean(subscription));
  const [boughtFor, setBoughtFor] = useState(subscription?.boughtFor ?? "");
  const [loginEmail, setLoginEmail] = useState(subscription?.loginEmail ?? "");
  const [notes, setNotes] = useState(subscription?.notes ?? "");

  /**
   * Who is on the plan — ids, and nothing else.
   *
   * A seat used to carry its own status and its own two dates. The owner took
   * all three off it: the date is given once, when the plan is bought, and
   * everybody on the plan gets that date. What is left of a seat is a person.
   */
  const [seats, setSeats] = useState<string[]>(
    subscription?.users.map((user) => user.teamMemberId) ?? [],
  );

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * Fill in whichever of the three was left out.
   *
   * Called after each of the money fields changes, with the field just typed
   * held fixed — so correcting the rate on a plan that already has both prices
   * recomputes the taka, rather than silently keeping a taka figure the new
   * rate contradicts.
   */
  function reprice(next: {
    costUsd?: string;
    costBdt?: string;
    usdRate?: string;
  }) {
    const merged = { costUsd, costBdt, usdRate, ...next };
    const derived = deriveCost(
      // Whichever two were typed most recently are the inputs; the third is
      // cleared first so `deriveCost` has a hole to fill.
      next.usdRate !== undefined
        ? { costUsd: merged.costUsd, usdRate: merged.usdRate }
        : next.costBdt !== undefined
          ? { costBdt: merged.costBdt, usdRate: merged.usdRate }
          : { costUsd: merged.costUsd, usdRate: merged.usdRate },
    );
    setCostUsd(derived.costUsd ?? merged.costUsd);
    setCostBdt(derived.costBdt ?? merged.costBdt);
    setUsdRate(derived.usdRate ?? merged.usdRate);
  }

  const agree = costsAgree({ costUsd, costBdt, usdRate });

  const chosen = new Set(seats);

  /**
   * The active team, plus anybody already holding a seat on this plan.
   *
   * The page fetches active members only, which is right for adding somebody.
   * But a plan seated by a person who has since left is exactly the plan
   * somebody opens — to take them off it — and without them in the options the
   * row rendered blank, as though the seat were empty. Then saving would have
   * silently dropped them.
   */
  const pickable = [
    ...members.map((member) => ({
      value: member.id,
      label: member.fullName,
    })),
    ...(subscription?.users ?? [])
      .filter(
        (user) => !members.some((member) => member.id === user.teamMemberId),
      )
      .map((user) => ({
        value: user.teamMemberId,
        label: `${user.fullName} (no longer active)`,
      })),
  ];

  async function save() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      // Said here as well as by the API, which refuses a blank name in the
      // same words. A round trip that comes back asking for the one field
      // somebody is already looking at is a round trip for nothing.
      if (!toolName.trim()) {
        setFieldErrors({ toolName: ["Name the tool"] });
        return;
      }

      const body = {
        toolName,
        planName,
        category,
        status,
        costUsd,
        costBdt,
        usdRate,
        billingCycle,
        startDate,
        // No longer asked for — the account picker is the only "paid by" the
        // form shows. It still has to be sent: the field's `.default("card")`
        // lands in the schema's output type, which is what the client is typed
        // against, so leaving it out is a compile error rather than a default.
        // The typed method, not a derivation — the two controls are separate
        // questions again on the owner's instruction.
        paymentMethod,
        accountId,
        boughtFor,
        loginEmail,
        websiteUrl,
        reference,
        notes,
        users: seats.map((teamMemberId) => ({
          teamMemberId,
          // Sent although nothing on screen sets it any more, and for the same
          // reason as `paymentMethod` above: `.default("active")` lands in the
          // schema's output type, which is the type the client is written
          // against, so omitting it is a compile error rather than a default.
          // The value is the plan's own status, because that is what the owner
          // said governs everybody on it. The dates are optional on the schema
          // and go unsent — the plan carries those too.
          status,
        })),
      };

      /*
       * Checked BEFORE the plan is written, not after.
       *
       * Saving the plan and then discovering there is nowhere to take the money
       * from leaves a plan with no payment and somebody wondering which half
       * happened. One refusal, nothing written.
       */
      if (!subscription && status === "active") {
        if (!accountId) {
          setPending(false);
          setError("Choose the card or account this is paid from — the price comes out of it when you save.");
          return;
        }
        if (!categoryId) {
          setPending(false);
          setError("Choose the expense heading, or the charge will not appear on any Expenses screen.");
          return;
        }
      }

      const saved = subscription
        ? await subscriptionsApi.update(subscription.id, body)
        : await subscriptionsApi.create(body);

      /*
       * A NEW plan takes its first payment out of the account, here.
       *
       * The owner's instruction, and the bug behind it: he had typed the price
       * and nothing anywhere moved. The plan was a plan and the money was a
       * second act nobody knew to perform, so the AI tools card read ৳0 and
       * All transactions was empty.
       *
       * Only on CREATE. Editing a plan must never take money again — a typo
       * fixed in the notes is not a purchase — and only when the plan is
       * ACTIVE, because adding a cancelled plan for the record is not a thing
       * to charge for today.
       *
       * Renewals are deliberately NOT automatic. Asked, the owner chose to be
       * TOLD rather than charged: "na, renew-er somoy amake ekta barta dileii
       * hobe". The reminder already exists and fires three days out, and one
       * click on the row records it. An app that writes money nobody watched
       * is an app whose books stop agreeing with the bank the first time a
       * card is declined.
       */
      if (!subscription && status === "active") {
        try {
          await payApi.pay(saved.id, {
            txnDate: startDate,
            categoryId,
            note: "First payment, recorded when the plan was added",
            /* The renewal date is already the first one AFTER today; advancing
               it here would skip a month. */
            advanceRenewal: false,
          });
        } catch (caught) {
          onSaved();
          setError(
            `The plan is saved, but the payment did not go through: ${
              caught instanceof ApiError ? caught.message : "try it again"
            }. Use "Record payment" on its row to take the money out.`,
          );
          return;
        }
      }

      /*
       * The paperwork, after the row exists for the same reason the screenshot
       * does. A failure here is reported and does not claim the plan was lost
       * — it was saved a moment ago, and sending somebody back to type it
       * again would be false.
       */
      for (const [file, kind, what] of [
        [invoiceFile, "invoice", "invoice"],
        [referenceFile, "bank_statement", "bank record"],
      ] as const) {
        if (!file) continue;
        try {
          await uploadSubscriptionFile(saved.id, file, kind);
        } catch (caught) {
          onSaved();
          setError(
            `The plan is saved, but the ${what} did not upload: ${
              caught instanceof ApiError ? caught.message : "try it again"
            }.`,
          );
          return;
        }
      }

      onSaved();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors ?? {});
      } else {
        setError("Could not save that.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `${subscription?.planName}` : "Add a subscription"}
      description="One plan, one price, one lifecycle — not one payment."
      footer={
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-negative">{error}</p>
          ) : (
            <span className="text-xs text-muted-foreground">
              What was actually paid stays on the Expenses screens.
            </span>
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={save}
              disabled={pending || !agree}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tool name" required error={fieldErrors.toolName}>
            {/* The box takes the whole row again. It was in a flex wrapper
                only so the paperclip could sit against its right edge, and
                with the clip gone the wrapper would have left the name field
                narrower than the Plan field beside it for no reason. */}
            <Input
              value={toolName}
              maxLength={160}
              placeholder="Claude, Figma, Github…"
              onChange={(e) => setToolName(e.target.value)}
              list="subscription-tool-names"
            />

            {/* Names already in the register, offered rather than imposed —
                the field is still free text, so a new tool is typed and not
                hunted for. They are the names on the list behind this drawer,
                which is the only place a tool's name is written down now: a
                second plan for something already on it should be spelled the
                way the first one was, or a search for either finds half. */}
            <datalist id="subscription-tool-names">
              {toolNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>

          <Field label="Plan" required error={fieldErrors.planName}>
            <Input
              value={planName}
              maxLength={160}
              placeholder="Max Plan 5x"
              onChange={(e) => setPlanName(e.target.value)}
            />
          </Field>

          <Field label="Category" required error={fieldErrors.category}>
            <Select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as SubscriptionCategory)
              }
            >
              {SUBSCRIPTION_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {SUBSCRIPTION_CATEGORY_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" error={fieldErrors.status}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
            >
              {SUBSCRIPTION_STATUSES.map((id) => (
                <option key={id} value={id}>
                  {SUBSCRIPTION_STATUS_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* ---------------------------------------------------------------- */}
        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Price</h3>
            <span className="text-xs text-muted-foreground">
              Type any two — the third follows
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="USD" required error={fieldErrors.costUsd}>
              <MoneyInput
                value={costUsd}
                placeholder="20.00"
                onChange={(e) => reprice({ costUsd: e.target.value })}
              />
            </Field>
            <Field label="USD rate" error={fieldErrors.usdRate}>
              <Input
                className="col-amount"
                inputMode="decimal"
                value={usdRate}
                placeholder="122.50"
                onChange={(e) => reprice({ usdRate: e.target.value })}
              />
            </Field>
            <Field label="BDT" error={fieldErrors.costBdt}>
              <MoneyInput
                value={costBdt}
                placeholder="2450.00"
                onChange={(e) => reprice({ costBdt: e.target.value })}
              />
            </Field>
          </div>

          {!agree ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              These three do not agree. Clear one and it will be worked out from
              the other two — a stored triple that does not tie out cannot be
              corrected later, because nothing says which of the three is wrong.
            </p>
          ) : null}
        </section>

        {/* ---------------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Billing cycle" error={fieldErrors.billingCycle}>
            <Select
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
            >
              {BILLING_CYCLES.map((id) => (
                <option key={id} value={id}>
                  {BILLING_CYCLE_LABELS[id]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Started on" required error={fieldErrors.startDate}>
            <DateInput
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>

          {/*
            Stated, not asked. A renewal date is the start date plus however
            many cycles have gone by, and two fields for one fact is two
            fields that can disagree.

            It still MOVES on its own afterwards: recording a payment advances
            the stored date by a cycle, which is real information this cannot
            know. So this says what the date will be when the plan is saved,
            not what it will read forever.
          */}
          <Field label="Renews on">
            <p className="flex h-9 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground">
              {derivedRenewal ? (
                <span className="num">{formatDate(derivedRenewal)}</span>
              ) : /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? (
                "Not recurring — no renewal date"
              ) : (
                "Choose when it started"
              )}
            </p>
          </Field>

          <Field label="Payment Method" error={fieldErrors.paymentMethod}>
            <Select
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value as PaymentMethod);
                setMethodTouched(true);
              }}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </Select>
          </Field>

          {/*
            Required now, both of them, because adding a plan takes the money
            out. Without an account there is nothing to take it FROM, and
            without a heading the expense lands where no Expenses screen shows
            it — which is the complaint this whole change answers. A form that
            accepted a plan and then quietly failed to charge it would be the
            same bug wearing a different face.
          */}
          <Field
            label="Expense heading"
            required={!subscription}
            hint="Where the charge shows up under Expenses"
          >
            <CategorySelect
              name="categoryId"
              value={categoryId}
              onChange={setCategoryId}
              categories={categories}
              kind="out"
            />
          </Field>

          <Field
            label="Account/Card"
            required={!subscription}
            error={fieldErrors.accountId}
          >
            <SearchableSelect
              value={accountId}
              onChange={(next) => {
                setAccountId(next);
                if (!methodTouched) {
                  const suggested = methodSuggestedBy(accounts, next);
                  if (suggested) setPaymentMethod(suggested);
                }
              }}
              placeholder="Which one pays it"
              options={accounts.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
            />
          </Field>

          <Field
            label="User Department"
            error={fieldErrors.boughtFor}
            hint="The team it was bought for, as you would say it"
          >
            <Input
              value={boughtFor}
              maxLength={160}
              placeholder="Engineering core"
              onChange={(e) => setBoughtFor(e.target.value)}
            />
          </Field>

          <Field
            label="Login accounts"
            error={fieldErrors.loginEmail}
            hint="Who pays and who uses are different questions"
          >
            <Input
              value={loginEmail}
              maxLength={200}
              onChange={(e) => setLoginEmail(e.target.value)}
            />
          </Field>

          <Field
            label="Website"
            error={fieldErrors.websiteUrl}
            hint="The tool's own page — what its name on the register opens"
          >
            <Input
              value={websiteUrl}
              maxLength={500}
              placeholder="https://claude.ai"
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
          </Field>

          {/*
            The same pair as every other drawer, and for the same reasons.

            The invoice is a DOCUMENT, not a number — "Invoice a sudhu upload
            system thakbe field lagbena" — so the box is gone and the clip
            stays. And there is one Reference rather than a Transaction ID with
            a toggle above it: there was only ever one field under that toggle,
            and asking which KIND of number this was made a decision out of
            something the row already showed.

            `invoice_no` is NOT dropped. Plans recorded before today carry
            numbers in it and the table still prints them; the form simply
            stops asking.
          */}
          <Field
            label="Invoice"
            hint="Attach the bill this plan was charged against"
          >
            <Clip
              picker={invoicePicker}
              file={invoiceFile}
              onPick={setInvoiceFile}
              label="Attach the invoice"
            >
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {invoiceFile ? "" : "No invoice attached"}
              </span>
            </Clip>
          </Field>

          <Field
            label="Reference"
            error={fieldErrors.reference}
            hint="Attach the bank or card record — there is no number to type"
          >
            {/* Attached, never typed — the same change the three ledger forms
                got. The stored value and every number already in it stay. */}
            <Clip
              picker={referencePicker}
              file={referenceFile}
              onPick={setReferenceFile}
              label="Attach the bank's record"
            >
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {referenceFile ? "" : "No reference attached"}
              </span>
            </Clip>
          </Field>
        </div>

        {/* ---------------------------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">User name</h3>

          {/* One picker, and picking somebody is the whole act of adding them.
              It holds no value of its own, so it clears itself and the next
              person can be chosen straight after — where the button that used
              to be here made you say twice, every time, that you wanted
              somebody on the plan. */}
          <Field label="Person" error={fieldErrors.users}>
            <SearchableSelect
              value=""
              onChange={(value) => setSeats([...seats, value])}
              placeholder="Pick somebody"
              options={pickable.filter(
                // Somebody already on the plan is not offered again — the API
                // refuses a duplicate, and finding that out on save is a worse
                // way to learn it.
                (person) => !chosen.has(person.value),
              )}
            />
          </Field>

          {/* Said out loud rather than left to a picker that opens onto
              nothing: these names are the active team, so an empty one means
              the Team screen is empty, not that the form is broken. */}
          {members.length === 0 ? (
            <p className="text-xs text-warning">
              There is nobody to pick. The names here are the active team —
              somebody has to be added on the Team screen first.
            </p>
          ) : null}

          {seats.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Nobody yet. A plan bought for the whole team still needs its
              people here — otherwise &ldquo;what is this person on&rdquo; comes
              back empty for all of them.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {seats.map((teamMemberId) => {
                // The name comes from `pickable`, which is why somebody who
                // has since left the company still reads as themselves — and
                // why their chip still says they are no longer active.
                const label =
                  pickable.find((person) => person.value === teamMemberId)
                    ?.label ?? "Somebody";
                // Chips wrap, and one is capped at the width of the row it
                // sits in: this drawer is 448px wide, so a long name has to be
                // allowed to run out of room rather than push the line off the
                // side of it.
                return (
                  <li
                    key={teamMemberId}
                    className="flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-muted py-1 pr-1 pl-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{label}</span>
                    <button
                      type="button"
                      aria-label={`Take ${label} off the plan`}
                      onClick={() =>
                        setSeats(seats.filter((id) => id !== teamMemberId))
                      }
                      className="shrink-0 cursor-pointer rounded-full p-1 text-muted-foreground transition hover:bg-negative/10 hover:text-negative"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Field label="Notes" error={fieldErrors.notes}>
          <Textarea
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {editing ? (
          <p className="text-xs text-muted-foreground">
            The plan screenshot is uploaded from the tool&apos;s name on the
            list — click it to see or replace what is there.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Save this first, then click the tool&apos;s name on the list to
            attach the plan screenshot.
          </p>
        )}
      </div>
    </Drawer>
  );
}
