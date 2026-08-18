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
import { Paperclip, Trash2, TriangleAlert } from "lucide-react";
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
import { vendorsApi, type AccountDto, type VendorDto } from "@/lib/masters";
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

type Seat = {
  teamMemberId: string;
  status: SubscriptionStatus;
  fromDate: string;
  untilDate: string;
};

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
  vendors,
  accounts,
  members,
  open,
  onClose,
  onSaved,
}: {
  subscription?: SubscriptionDto;
  vendors: VendorDto[];
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
   * already known and hunting for it in a list is work the form invented. The
   * vendor row behind it is still real — it is looked up by name on save, and
   * created when it is new, so a name typed once becomes a name the rest of
   * the app can group spending by.
   */
  const [toolName, setToolName] = useState(subscription?.vendorName ?? "");

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

  const [seats, setSeats] = useState<Seat[]>(
    subscription?.users.map((user) => ({
      teamMemberId: user.teamMemberId,
      status: user.status,
      fromDate: user.fromDate ?? "",
      untilDate: user.untilDate ?? "",
    })) ?? [],
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

  const chosen = new Set(seats.map((seat) => seat.teamMemberId));

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

  /**
   * The vendor row behind the typed name.
   *
   * Matched case-insensitively against what is already on the books, so
   * "claude" and "Claude" stay one company rather than two that never add up.
   * Created when it is genuinely new — which is the point of typing the name
   * instead of picking it.
   */
  async function resolveVendor(): Promise<string> {
    const wanted = toolName.trim();
    const existing = vendors.find(
      (vendor) => vendor.name.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (existing) return existing.id;
    const created = await vendorsApi.create({
      name: wanted,
      // The vendor is a stub the subscription hangs on: what it costs, how
      // often and in what currency all live on the subscription itself, so
      // repeating them here would be two places to change one price.
      type: "ai_tool",
      billingCycle: "none",
      billingCurrency: "USD",
      psrStatus: "unknown",
    });
    return created.id;
  }

  async function save() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      if (toolName.trim().length < 2) {
        setFieldErrors({ vendorId: ["Give the tool a name"] });
        return;
      }
      const vendorId = await resolveVendor();

      const body = {
        vendorId,
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
        users: seats
          // A row somebody opened and left empty is not a person.
          .filter((seat) => seat.teamMemberId !== "")
          .map((seat) => ({
            teamMemberId: seat.teamMemberId,
            status: seat.status,
            fromDate: seat.fromDate || undefined,
            untilDate: seat.untilDate || undefined,
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
          <Field label="Tool name" required error={fieldErrors.vendorId}>
            <div className="flex items-center gap-2">
              <Input
                value={toolName}
                maxLength={120}
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

            {/* Names already on the books, offered rather than imposed — the
                field is still free text, so a new tool is typed and not
                hunted for. */}
            <datalist id="subscription-tool-names">
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.name} />
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
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">User name</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSeats([
                  ...seats,
                  {
                    teamMemberId: "",
                    status: "active",
                    fromDate: "",
                    untilDate: "",
                  },
                ])
              }
            >
              Add somebody
            </Button>
          </div>

          {fieldErrors.users ? (
            <p className="text-xs text-negative">{fieldErrors.users[0]}</p>
          ) : null}

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
            <ul className="flex flex-col gap-2">
              {seats.map((seat, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-2 rounded-lg border border-border p-3"
                >
                  {/* Stacked, because this drawer is 448px wide and four
                      controls on one line collapsed the person picker to
                      nothing — its label printed on top of the next one's and
                      there was no visible way to choose anybody at all. */}
                  <div className="flex items-end gap-2">
                    <Field label="Person" className="min-w-0 flex-1">
                      <SearchableSelect
                        value={seat.teamMemberId}
                        onChange={(value) =>
                          setSeats(
                            seats.map((s, i) =>
                              i === index ? { ...s, teamMemberId: value } : s,
                            ),
                          )
                        }
                        placeholder="Pick somebody"
                        options={pickable
                          // Somebody already on the plan is not offered again —
                          // the API refuses a duplicate, and finding that out on
                          // save is a worse way to learn it.
                          .filter(
                            (person) =>
                              person.value === seat.teamMemberId ||
                              !chosen.has(person.value),
                          )}
                      />
                    </Field>

                    <button
                      type="button"
                      aria-label="Take this person off the plan"
                      onClick={() =>
                        setSeats(seats.filter((_, i) => i !== index))
                      }
                      className="mb-1 shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground transition hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Status">
                      <Select
                        value={seat.status}
                        onChange={(e) =>
                          setSeats(
                            seats.map((s, i) =>
                              i === index
                                ? {
                                    ...s,
                                    status: e.target
                                      .value as SubscriptionStatus,
                                  }
                                : s,
                            ),
                          )
                        }
                      >
                        {SUBSCRIPTION_STATUSES.map((id) => (
                          <option key={id} value={id}>
                            {SUBSCRIPTION_STATUS_LABELS[id]}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="From">
                      <DateInput
                        value={seat.fromDate}
                        onChange={(e) =>
                          setSeats(
                            seats.map((s, i) =>
                              i === index
                                ? { ...s, fromDate: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                    </Field>

                    <Field label="Until">
                      <DateInput
                        value={seat.untilDate}
                        onChange={(e) =>
                          setSeats(
                            seats.map((s, i) =>
                              i === index
                                ? { ...s, untilDate: e.target.value }
                                : s,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                </li>
              ))}
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
