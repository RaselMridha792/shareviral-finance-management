"use client";

import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CATEGORY_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  costsAgree,
  deriveCost,
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ApiError } from "@/lib/api-client";
import type { AccountDto } from "@/lib/masters";
import type { TeamMemberDto } from "@/lib/payroll";
import {
  subscriptionsApi,
  uploadSubscriptionScreenshot,
  type SubscriptionDto,
} from "@/lib/subscriptions";

/**
 * The payment method the chosen account implies.
 *
 * The owner merged "Paid by" and "Card or account" — they meant the same thing
 * to them, and the account is the one that carries a name. The enum column did
 * not go away with the control, so it is worked out here instead of being left
 * at a default that would be wrong for every bank account.
 *
 * Falls back to what was already stored when nothing is picked, so editing a
 * plan's name cannot quietly rewrite how it is paid.
 */
function methodOfAccount(
  accounts: AccountDto[],
  accountId: string,
  existing?: SubscriptionDto,
): PaymentMethod {
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) return (existing?.paymentMethod as PaymentMethod) ?? "card";

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
export function SubscriptionForm({
  subscription,
  toolNames,
  accounts,
  members,
  open,
  onClose,
  onSaved,
}: {
  subscription?: SubscriptionDto;
  /** Every tool name already on the list behind this drawer — see below. */
  toolNames: string[];
  accounts: AccountDto[];
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

  /**
   * The plan screenshot, chosen while typing and posted once there is a row to
   * hang it on. A file needs the subscription's id, which does not exist until
   * the save returns — that is the only reason it is not uploaded here.
   */
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const screenshotPicker = useRef<HTMLInputElement>(null);
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
  const [nextRenewalOn, setNextRenewalOn] = useState(
    subscription?.nextRenewalOn ?? "",
  );

  const [accountId, setAccountId] = useState(subscription?.accountId ?? "");
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
        nextRenewalOn,
        // No longer asked for — the account picker is the only "paid by" the
        // form shows. It still has to be sent: the field's `.default("card")`
        // lands in the schema's output type, which is what the client is typed
        // against, so leaving it out is a compile error rather than a default.
        // Sending back what is stored keeps editing a bank-transfer plan from
        // quietly turning it into a card one.
        // There is one control now, and it names an account. The column still
        // exists, so it is derived from what that account IS rather than
        // stamped "card" on everything — a bank account paying a plan is a
        // transfer, and anything grouping by this would otherwise be wrong for
        // every row created from here on.
        paymentMethod: methodOfAccount(accounts, accountId, subscription),
        accountId,
        boughtFor,
        loginEmail,
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

      const saved = subscription
        ? await subscriptionsApi.update(subscription.id, body)
        : await subscriptionsApi.create(body);

      /**
       * The plan is saved by here, so a screenshot that will not upload is not
       * a failed save. Said out loud rather than swallowed, and rather than
       * reported as the whole thing having failed.
       */
      if (screenshot) {
        try {
          await uploadSubscriptionScreenshot(saved.id, screenshot);
        } catch (caught) {
          onSaved();
          setError(
            `The plan is saved, but the screenshot did not upload: ${
              caught instanceof ApiError ? caught.message : "try it again"
            }. Click the tool's name on the list to attach it.`,
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
            <div className="flex items-center gap-2">
              <Input
                value={toolName}
                maxLength={160}
                placeholder="Claude, Figma, Github…"
                onChange={(e) => setToolName(e.target.value)}
                list="subscription-tool-names"
              />
              {/* The plan screenshot, beside the name it belongs to — and the
                  same picture the tool's name opens on the list. */}
              <input
                ref={screenshotPicker}
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  setScreenshot(event.target.files?.[0] ?? null);
                  // Cleared so picking the same file twice still fires.
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => screenshotPicker.current?.click()}
                title="Attach a screenshot of the plan"
                aria-label="Attach a screenshot of the plan"
                className="shrink-0 cursor-pointer rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
              >
                <Paperclip className="size-4" />
              </button>
            </div>

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

            {screenshot ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {screenshot.name}
                </span>
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  className="shrink-0 cursor-pointer font-medium text-negative hover:underline"
                >
                  Remove
                </button>
              </p>
            ) : null}
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

          <Field
            label="Renews on"
            error={fieldErrors.nextRenewalOn}
            hint="Leave empty when there is no date — say why in Notes"
          >
            <DateInput
              value={nextRenewalOn}
              onChange={(e) => setNextRenewalOn(e.target.value)}
            />
          </Field>

          <Field label="Payment Method" error={fieldErrors.accountId}>
            <SearchableSelect
              value={accountId}
              onChange={setAccountId}
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
