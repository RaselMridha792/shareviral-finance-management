import {
  amountSchema,
  CHARGE_TWICE_MESSAGE,
  chargeStatedOnce,
} from "@finance/shared";
import { z } from "zod";

/*
 * Declared in this module rather than in packages/shared: that package is
 * consumed as built dist/ by twenty others. In a file of its own (2 Oct
 * 2026) because two things read it now — the endpoint that takes a renewal,
 * and the assistant, which checks a drafted renewal against this before it
 * offers Save.
 */
export const paySubscriptionFields = z.object({
  txnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was charged"),
  /** Blank means the plan's own price. */
  amount: z.string().trim().optional(),
  /** Blank means the card on the plan. */
  accountId: z.string().uuid().optional(),
  /*
   * Required, because the ledger requires it.
   *
   * `createTransactionSchema` will not write an expense without a category and
   * is right not to: an uncategorised entry does not appear on any Expenses
   * screen, which is the very complaint this feature exists to answer. A
   * subscription's own category — `ai_tool`, `hosting` — is the register's
   * vocabulary rather than the company's expense headings, so there is nothing
   * to derive it from and it is asked for.
   */
  /*
   * Optional now, and worked out when it is absent.
   *
   * It was required because the ledger refuses an uncategorised expense, and
   * that is still true — but the answer was always the same one, so asking put
   * a picker on two drawers for a question nobody had to think about.
   * `subscriptionCategoryId()` resolves it, and refuses loudly if the company
   * has no such heading rather than filing the charge nowhere.
   */
  categoryId: z.string().uuid().optional(),
  note: z.string().trim().max(200).nullish(),
  /** Roll the renewal on a cycle. Off for a payment being recorded late. */
  advanceRenewal: z.boolean().optional(),
  /**
   * The rate this payment is read back at.
   *
   * Every entry carries one now — *"puro application a joto dhoroner
   * transaction a hok na keno manually prottekbar rate bosate hobe"*. Optional
   * HERE and only here, because a plan already states the rate its price was
   * struck at and the dialog offers that as the figure: absent, the plan's own
   * rate is used, and the row still ends up carrying one.
   */
  usdRate: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77")
    .optional(),
  /**
   * What the card was actually billed, in dollars.
   *
   * The plan's price is the default and usually the answer, but a renewal is
   * not obliged to match it — a seat was added, a promotion ended, the vendor
   * put its price up. Stated here, the row carries it as `original_amount`,
   * which is what a USD card's own balance is built from.
   */
  usdAmount: z.string().trim().optional(),
  /**
   * The bank's fee on this charge, as its own row under Bank charges.
   *
   * The owner asked for it on every kind of transaction — *"sob dhoroner
   * transaction a ei charge ta rakho. karon bank charge dorkar hoy sob
   * transaction er khetrei"* — and a card renewal is one. Distinct from the
   * plan's own `chargeUsd`, which is part of what the VENDOR bills and is
   * already inside the price; this is what the BANK takes on top.
   */
  chargeAmount: z.string().trim().optional(),
  /**
   * The same fee in dollars, which is how the Renew drawer asks for it now —
   * the owner: *"jokhon usd hobe tokhon bank charge o usd howa ucit"*, and a
   * plan is billed in dollars. Worked out in taka at this payment's rate.
   * Still not the plan's own `chargeUsd`: that one is the VENDOR's.
   */
  chargeUsd: amountSchema.optional(),
});
export const paySubscriptionSchema = paySubscriptionFields.refine(
  chargeStatedOnce,
  {
    message: CHARGE_TWICE_MESSAGE,
    path: ["chargeUsd"],
  },
);
export type PaySubscriptionInput = z.infer<typeof paySubscriptionSchema>;
