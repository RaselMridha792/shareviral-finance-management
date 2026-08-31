import { z } from "zod";

import {
  amountSchema,
  BILLING_CYCLE_MONTHS,
  billingCycleSchema,
  isoDateSchema,
  subscriptionCategorySchema,
  subscriptionStatusSchema,
  type BillingCycle,
  type VendorType,
} from "./masters.ts";
import { addMonths, type IsoDate } from "./datetime.ts";
import { paginationQuerySchema } from "./pagination.ts";
import { isNAText } from "./transactions.ts";
import { patchOf } from "./patch.ts";
import { paymentMethodSchema } from "./transactions.ts";

/**
 * The tools the company uses, what they usually cost, and what was actually
 * paid for them.
 *
 * There is deliberately no projection in this file. These are bought month by
 * month — some months yes, some months no — so a stored "renews on the 3rd" is
 * a habit, not a schedule, and a monthly total built from it would assert
 * spending that may never happen. Every figure below comes from the ledger,
 * and the stored price is carried only as context: "about $20 a month".
 */

/**
 * How a billing cycle reads once it is a habit rather than a commitment.
 *
 * `BILLING_CYCLE_LABELS` says "Every month", which is a promise nobody made.
 * These say "About monthly", which is what the company actually knows.
 */
export const BILLING_CYCLE_HABIT_LABELS: Record<BillingCycle, string> = {
  none: "As needed",
  monthly: "About monthly",
  quarterly: "About quarterly",
  yearly: "About yearly",
};

export type SubscriptionLine = {
  id: string;
  name: string;
  type: VendorType;
  /** How often it tends to get bought. A habit, not a schedule. */
  billingCycle: BillingCycle;
  /** What it usually costs, in `billingCurrency`. Context, not a bill. */
  billingAmount: string | null;
  billingCurrency: string;
  /** What actually left the accounts for this tool in the period, in BDT. */
  paidThisPeriod: string;
  /** How many ledger entries made that up. */
  entriesThisPeriod: number;
  /** The most recent payment ever recorded against it, period or not. */
  lastPaidOn: string | null;
  /** Where it is usually paid from — the card, most often. */
  billingAccountId: string | null;
  billingAccountName: string | null;
};

export type SubscriptionSummary = {
  /** The period every "this period" figure below is measured over. */
  period: { label: string; start: string; end: string };
  /**
   * Everything that left the accounts on tooling this period.
   *
   * The same rule as the overview's "AI tooling & subscriptions" tile: money
   * out to a tool vendor, or out of a non-taka account. That makes it at least
   * the sum of the lines and sometimes more, because card spend nobody
   * attributed to a named tool is still tooling.
   */
  paidThisPeriod: string;
  /**
   * The part of `paidThisPeriod` that no line below accounts for — card
   * spending nobody attributed to a tool. "0.00" when everything ties out.
   *
   * Computed alongside the total rather than by subtracting in the browser:
   * this is a difference of two ledger figures, and `0.1 + 0.2` has no place
   * in one.
   */
  unattributed: string;
  /** Every tool on the books, by name. */
  lines: SubscriptionLine[];
};

/**
 * Has this one been bought in the period being looked at?
 *
 * Postgres hands back "0.00" for a tool with no entries, which is falsy in
 * neither the string nor the loose-equality sense — the comparison has to be
 * numeric or every tool reads as paid.
 */
export function wasPaidInPeriod(line: SubscriptionLine): boolean {
  return Number(line.paidThisPeriod) > 0;
}

/* -------------------------------------------------------------------------- */
/*  The tools register — a thing the app holds, not a view over the ledger     */
/* -------------------------------------------------------------------------- */

/**
 * A paid seat: one plan, one price, one lifecycle.
 *
 * Separate from everything above, which derives what was *paid* from the
 * ledger. This is what was *bought*: the plan, who is on it, which card renews
 * it, what the screenshot of it looks like. None of it is summed into a report
 * — the ledger is still the only place a total comes from.
 */

/**
 * The three money fields, and the rule that keeps them honest.
 *
 * All three are stored on the owner's instruction: the bills arrive in both
 * currencies and both are wanted. What is not optional is that they agree. A
 * form that accepted all three independently is exactly how the Cash In sheet
 * came to hold a row whose rate disagrees with its own amounts by ৳27,612,
 * with nothing in the file to say which of the three is wrong.
 *
 * So: give any two and the third follows. `deriveCost` is what the form calls
 * on every keystroke, and the API refuses a triple that does not tie out —
 * within one paisa, because 20 x 122.50 is exact but 19.99 x 122.4567 is not.
 */
export function deriveCost(input: {
  costUsd?: string;
  costBdt?: string;
  usdRate?: string;
}): { costUsd?: string; costBdt?: string; usdRate?: string } {
  const usd = numberOrNull(input.costUsd);
  const bdt = numberOrNull(input.costBdt);
  const rate = numberOrNull(input.usdRate);

  if (usd !== null && rate !== null && bdt === null) {
    return { ...input, costBdt: (usd * rate).toFixed(2) };
  }
  if (usd !== null && bdt !== null && rate === null && usd !== 0) {
    return { ...input, usdRate: (bdt / usd).toFixed(6) };
  }
  if (bdt !== null && rate !== null && usd === null && rate !== 0) {
    return { ...input, costUsd: (bdt / rate).toFixed(2) };
  }
  return input;
}

/**
 * Do the three agree?
 *
 * True when any of them is missing — this is a check on a complete triple, not
 * a requirement that one exists. The tolerance is one paisa: the rate is kept
 * to six places and the amounts to two, so a product that is exact in full
 * precision can still land half a paisa off once both ends are rounded.
 */
export function costsAgree(input: {
  costUsd?: string | null;
  costBdt?: string | null;
  usdRate?: string | null;
}): boolean {
  const usd = numberOrNull(input.costUsd);
  const bdt = numberOrNull(input.costBdt);
  const rate = numberOrNull(input.usdRate);
  if (usd === null || bdt === null || rate === null) return true;
  return Math.abs(usd * rate - bdt) <= 0.01;
}

function numberOrNull(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/* -------------------------------------------------------------------------- */
/*  Request contracts                                                          */
/* -------------------------------------------------------------------------- */

/**
 * One person on a plan.
 *
 * Its own status, because a plan can be perfectly active while one person's
 * access to it was cancelled in July. Its own dates, because the question was
 * every tool somebody has *ever* been on, and without them the table can only
 * answer who is on it now.
 */
export const subscriptionUserSchema = z.strictObject({
  teamMemberId: z.uuid("Pick somebody from the team"),
  fromDate: isoDateSchema.optional(),
  untilDate: isoDateSchema.optional(),
  status: subscriptionStatusSchema.default("active"),
});
export type SubscriptionUserInput = z.infer<typeof subscriptionUserSchema>;

const optionalSubText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? undefined : v))
    .optional();

const optionalMoney = z
  .union([amountSchema, z.literal("")])
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/**
 * The fields, before either contract adds its rules.
 *
 * Kept separate so the PATCH body can be built with `patchOf` — see that file
 * for the three endpoints that quietly rewrote fields nobody sent, because
 * `.partial()` keeps a `.default()` inside the now-optional field and
 * materialises it on an absent key.
 */
const subscriptionFieldsSchema = z.strictObject({
  /**
   * What the tool is called, as text.
   *
   * This was a `vendors` row, and the form created one from whatever was typed
   * into it — the same free-text-becomes-a-record path that `transactions`
   * refuses on purpose, only worse, because a plan for a $20 tool minted a
   * company on the books that nobody asked for and no screen ever showed.
   *
   * Nothing was gained by it. The payment for a tool is an ordinary expense in
   * a category that already exists, and the register only ever needed to say
   * which tool the plan is for. A name does that.
   */
  toolName: z.string().trim().min(1, "Name the tool").max(160),
  planName: z.string().trim().min(1, "Name the plan").max(160),
  category: subscriptionCategorySchema,
  status: subscriptionStatusSchema.default("active"),

  costUsd: amountSchema,
  costBdt: optionalMoney,
  usdRate: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.50"),
      z.literal(""),
    ])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  billingCycle: billingCycleSchema.default("monthly"),

  startDate: isoDateSchema,
  /*
   * No `nextRenewalOn`. It is worked out from the start date and the cycle —
   * `nextRenewalAfter` below — and moves after that only when a payment is
   * recorded against the plan.
   *
   * Removed rather than accepted-and-ignored: a field the server quietly
   * discards is worse than one it refuses, because the caller has no way to
   * find out. A client still sending it now gets an error naming the key.
   *
   * `renewalNote` stays and matters more for it. The importer's sheet has rows
   * saying "Credit Base" where a date belongs, and that is where the reason
   * goes.
   */
  renewalNote: optionalSubText(120),

  paymentMethod: paymentMethodSchema.default("card"),
  accountId: z
    .union([z.uuid(), z.literal("")])
    .transform((v) => (v === "" ? undefined : v))
    .optional(),

  boughtFor: optionalSubText(160),
  loginEmail: optionalSubText(200),

  /**
   * The tool's own page, so the name on the row goes somewhere.
   *
   * Shape only, never reachability — a link that 404s next year is still the
   * link somebody recorded, and refusing to save it because a request failed
   * would block recording a plan on a bad connection.
   */
  // A typed "N/A" counts as leaving the box empty — see isNAText's note.
  websiteUrl: z
    .string()
    .trim()
    .transform((v) => (v === "" || isNAText(v) ? undefined : v))
    .optional()
    .refine((v) => v === undefined || /^https:\/\/\S+$/.test(v), {
      message: "Paste an https:// link",
    }),

  /** Ours — the bill this plan was charged against. */
  invoiceNo: optionalSubText(60),
  /** Theirs — what the bank or the card statement calls the payment. */
  reference: optionalSubText(120),

  notes: optionalSubText(2000),

  users: z.array(subscriptionUserSchema).max(60).default([]),
});

export const createSubscriptionSchema = subscriptionFieldsSchema
  .refine(costsAgree, {
    message: "The dollar price, the taka price and the rate do not agree",
    path: ["costBdt"],
  })
  .refine(
    (v) => new Set(v.users.map((u) => u.teamMemberId)).size === v.users.length,
    {
      message: "Somebody is on this list twice",
      path: ["users"],
    },
  );
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

/**
 * A change to one.
 *
 * `users` is the whole list when it is given at all — sending the set that
 * should be on the plan is the only shape that can express a removal, and a
 * seat somebody quietly keeps is exactly what this register exists to stop.
 */
export const updateSubscriptionSchema = patchOf(subscriptionFieldsSchema)
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" })
  .refine(costsAgree, {
    message: "The dollar price, the taka price and the rate do not agree",
    path: ["costBdt"],
  });
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;

/**
 * What the register's own screen asks for.
 *
 * `status` takes the four real states; the fifth tab on screen is "All", which
 * is the absence of this filter rather than a value of it — a status called
 * "all" would end up in a database column one day.
 */
export const listSubscriptionsQuerySchema = paginationQuerySchema.extend({
  status: subscriptionStatusSchema.optional(),
  category: subscriptionCategorySchema.optional(),
  vendorId: z.uuid().optional(),
  teamMemberId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListSubscriptionsQuery = z.infer<
  typeof listSubscriptionsQuerySchema
>;

/* -------------------------------------------------------------------------- */
/*  When a plan renews — worked out, not typed                                */
/* -------------------------------------------------------------------------- */

/**
 * The next time a plan renews, counted from the day it started.
 *
 * The owner's instruction: *"If select Monthly hoy tahole renews date auto
 * calculation hobe ekhane notun kore renewal date dite hobena oi field ta
 * remove korte hobe"*. A renewal date is not an independent fact — it is the
 * start date plus however many cycles have gone by — and typing it separately
 * meant two fields that could disagree, with nothing to say which was right.
 *
 * Counted forward rather than added once, because a plan entered today may have
 * started in 2024. `startDate + 1 month` would then be a date two years in the
 * past presented as "next renewal".
 *
 * Strictly after `today`: a plan renewing today has not renewed yet, but it is
 * the payment being recorded that moves it, not this function.
 */
export function nextRenewalAfter(
  startDate: IsoDate,
  cycle: BillingCycle,
  today: IsoDate,
): IsoDate | null {
  /* `BILLING_CYCLE_MONTHS` already states this and has since the register was
     built — 0 for `none`, which is a real answer: a lifetime licence renews on
     no date at all. A second table of the same fact is how the two drift. */
  const months = BILLING_CYCLE_MONTHS[cycle];
  if (!months) return null;

  /*
   * Stepped rather than solved with arithmetic on the month count, because
   * `addMonths` clamps: a plan started on the 31st renews on the 30th, the 28th
   * and the 31st again depending on the month, and only walking it produces
   * that. The loop is bounded — a monthly plan started in 2000 is 300-odd
   * steps, and the cap stops a bad date spinning forever.
   */
  let next = addMonths(startDate, months);
  let guard = 0;
  while (next <= today && guard < 2400) {
    next = addMonths(next, months);
    guard += 1;
  }
  return next;
}
