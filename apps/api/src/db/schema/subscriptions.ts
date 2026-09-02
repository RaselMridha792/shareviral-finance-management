import { relations } from "drizzle-orm";
import {
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import {
  paymentMethodEnum,
  subscriptionCategoryEnum,
  subscriptionStatusEnum,
} from "./enums";
import { teamMembers } from "./team";
import { vendors } from "./vendors";
import { deletion } from "./shared-columns";

/**
 * A paid seat: one plan, one price, one lifecycle.
 *
 * Not the same thing as the tool. Claude is one tool and nine of these — Pro
 * for seven people, Max 5x, Max 20x — each with its own price, cycle and
 * status. The tools sheet has one row per person per billing period, which
 * mixes the subscription with each month of it; this holds the subscription,
 * and the months are ledger rows, where every other figure in this app lives.
 *
 * It sits beside `packages/shared/src/subscriptions.ts` rather than replacing
 * it. That file computes what was actually *paid* for a tool from the ledger,
 * deliberately — a stored "renews on the 3rd" is a habit rather than a
 * schedule, and a total built from it asserts spending that may never have
 * happened. Nothing here is summed into a report. `costUsd` is the price as
 * billed: context, not a bill.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id"),

    /**
     * What the tool is called. Claude, Figma, Github.
     *
     * Text, and not a `vendors` row any longer. Typing a name into the form
     * used to mint a company on the books — the same free-text-becomes-a-record
     * path `transactions` refuses on purpose — and nothing was bought with it:
     * paying for a tool is an ordinary expense in a category that already
     * exists, and this register only ever needed to say which tool a plan is
     * for.
     */
    toolName: varchar("tool_name", { length: 160 }).notNull(),

    /**
     * The company a plan was bought from, on the rows written before there was
     * a name column.
     *
     * Nullable, never written now, and kept on purpose: for those rows it is
     * the only record of which company the plan came from, and the joined name
     * is what the register falls back to when `toolName` is empty. Dropping it
     * would take a fact with it that nothing else in the database holds. The
     * relation below stays for the same reason — the fallback is a join.
     */
    vendorId: uuid("vendor_id"),

    /** "Max Plan 5x", "Professional Full seats". */
    planName: varchar("plan_name", { length: 160 }).notNull(),

    category: subscriptionCategoryEnum("category").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("active"),

    /**
     * All three stored, on the owner's instruction, and the form computes
     * whichever of them was not typed.
     *
     * The argument against keeping the last two is that a dollar price is the
     * fact and taka is a reading of it — which is how the rest of this app
     * works. The argument for is that this company's bills arrive in both and
     * they want both. That is their call; what is not optional is that the
     * three agree, which is why the screen derives rather than accepts. The
     * Cash In sheet already contains a row where all three were typed and one
     * of them is wrong by ৳27,612, with nothing in the file to say which.
     */
    costUsd: numeric("cost_usd", { precision: 14, scale: 2 }).notNull(),
    costBdt: numeric("cost_bdt", { precision: 14, scale: 2 }),

    /**
     * What the card adds on top, in taka.
     *
     * A plan priced at $100 does not cost this company the taka that converts
     * to: the bank levies a conversion or service charge on the way, and the
     * figure that leaves the account is the two together. That charge is not
     * part of the vendor's price and is not derived from `usd_rate` — it is
     * levied here, in taka — so it sits beside `cost_bdt` rather than inside
     * it, and `payableBdt()` in the shared package is the one place the two
     * are added.
     *
     * Nullable on purpose: a plan nobody has recorded a charge for shows an
     * empty box, not a confident 0.00.
     */
    chargeBdt: numeric("charge_bdt", { precision: 14, scale: 2 }),
    usdRate: numeric("usd_rate", { precision: 18, scale: 6 }),

    /**
     * Plain text, matching `vendors.billing_cycle`, which is also plain text
     * and constrained only by the shared `BILLING_CYCLES` array.
     *
     * Declaring this one as a pgEnum would leave two tables disagreeing about
     * a single idea — one checked by Postgres, one not — which is worse than
     * either choice made consistently.
     */
    billingCycle: text("billing_cycle").notNull().default("monthly"),

    startDate: date("start_date").notNull(),

    /**
     * Nullable, and that is what the sheet needs: one row says "Credit Base"
     * where a date belongs. Forcing a date there produces either a wrong one
     * or a lost row, and the reason lives in the note below instead.
     */
    nextRenewalOn: date("next_renewal_on"),
    renewalNote: varchar("renewal_note", { length: 120 }),

    paymentMethod: paymentMethodEnum("payment_method")
      .notNull()
      .default("card"),
    /** Which card or account actually pays it. */
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),

    /**
     * The team it was bought for, as typed: "Engineering Core", "Whole
     * development team". Free text on purpose — these are not the app's
     * departments and inventing an enum for them would force somebody to
     * choose the nearest wrong one.
     */
    boughtFor: varchar("bought_for", { length: 160 }),

    /**
     * The login the subscription is held under.
     *
     * A label, not a person, and deliberately not a foreign key. Github sits
     * under nizam@ and nizam is not among its users at all — who pays and who
     * uses are different questions, and the second is `subscription_users`.
     * It may also not be an office address.
     */
    loginEmail: varchar("login_email", { length: 200 }),

    /**
     * The same two numbers every other money row carries.
     *
     * `invoiceNo` is ours — the bill the plan was charged against. `reference`
     * is theirs — what the bank or the card statement calls the payment. One
     * field would hold whichever was typed first and the other fact would have
     * nowhere to be.
     */
    /** The tool's own page — what the name on the register links to. */
    websiteUrl: varchar("website_url", { length: 500 }),

    invoiceNo: varchar("invoice_no", { length: 60 }),
    reference: varchar("reference", { length: 120 }),

    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    ...deletion(),
  },
  (t) => [
    index("subscriptions_vendor_idx").on(t.vendorId),
    index("subscriptions_status_idx").on(t.status, t.nextRenewalOn),
    index("subscriptions_account_idx").on(t.accountId),
  ],
);

/**
 * Who is on a subscription.
 *
 * A join table rather than a column, and the sheet is the argument: Clickup is
 * one row at $130 for "13 seats" with twelve people marked against it, and
 * Github one row at $40 with nine. A `team_member_id` on the subscription
 * could only have named one of them and would have dropped the rest silently —
 * and "which tools is this person on" would have come back wrong rather than
 * empty, which is the worse way to be wrong.
 *
 * `from` and `until` because the request was for every tool somebody has
 * *ever* been on. Without dates the table answers "who is on this now" and
 * cannot answer "what was Mirza on in June".
 *
 * `status` lives here too, and is not the subscription's. A plan can be
 * perfectly active while one person's access to it was cancelled in July.
 */
export const subscriptionUsers = pgTable(
  "subscription_users",
  {
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),

    fromDate: date("from_date"),
    untilDate: date("until_date"),
    status: subscriptionStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    ...deletion(),
  },
  (t) => [
    primaryKey({ columns: [t.subscriptionId, t.teamMemberId] }),
    // The team page reads this the other way round — "what is this person on"
    // — and the primary key's leading column cannot serve that.
    index("subscription_users_member_idx").on(t.teamMemberId, t.status),
  ],
);

export const subscriptionsRelations = relations(
  subscriptions,
  ({ one, many }) => ({
    vendor: one(vendors, {
      fields: [subscriptions.vendorId],
      references: [vendors.id],
    }),
    account: one(accounts, {
      fields: [subscriptions.accountId],
      references: [accounts.id],
    }),
    users: many(subscriptionUsers),
  }),
);

export const subscriptionUsersRelations = relations(
  subscriptionUsers,
  ({ one }) => ({
    subscription: one(subscriptions, {
      fields: [subscriptionUsers.subscriptionId],
      references: [subscriptions.id],
    }),
    teamMember: one(teamMembers, {
      fields: [subscriptionUsers.teamMemberId],
      references: [teamMembers.id],
    }),
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionUser = typeof subscriptionUsers.$inferSelect;
export type NewSubscriptionUser = typeof subscriptionUsers.$inferInsert;
