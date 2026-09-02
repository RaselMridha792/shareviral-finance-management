import type {
  BillingCycle,
  CreateSubscriptionInput,
  ListSubscriptionsQuery,
  Paginated,
  SubscriptionCategory,
  SubscriptionStatus,
  UpdateSubscriptionInput,
} from "@finance/shared";
import { PAGE_SIZE } from "@/lib/pagination";

import { apiFetch, apiUpload, type StoredFile } from "./api-client";

/** One person's seat on a plan, as the register returns it. */
export type SubscriptionSeatDto = {
  subscriptionId: string;
  teamMemberId: string;
  fullName: string;
  status: SubscriptionStatus;
  fromDate: string | null;
  untilDate: string | null;
};

export type SubscriptionDto = {
  id: string;
  /**
   * The tool this plan is for, as text.
   *
   * It used to arrive as a join onto `vendors` — a row the form minted from
   * this very name. The join is gone and so is the id beside it: nothing on
   * any screen read that id, and keeping it would leave a field here that no
   * longer points at anything.
   */
  toolName: string;
  planName: string;
  category: SubscriptionCategory;
  status: SubscriptionStatus;
  /**
   * All three, on the owner's instruction — the bills arrive in both
   * currencies. The form derives whichever was not typed, so a row never holds
   * two of three and no screen has to guess the missing one.
   */
  costUsd: string;
  costBdt: string | null;
  /**
   * What the card adds on top of the price, in taka.
   *
   * Beside `costBdt`, never inside it: the dollar price, the rate and the taka
   * equivalent are one fact stated three ways, and a bank charge is a second
   * fact that would make the rate wrong if it were folded in. `payableBdt()`
   * is the one place they are added.
   */
  chargeBdt: string | null;
  usdRate: string | null;
  billingCycle: BillingCycle;
  startDate: string;
  nextRenewalOn: string | null;
  renewalNote: string | null;
  paymentMethod: string;
  accountId: string | null;
  accountName: string | null;
  boughtFor: string | null;
  loginEmail: string | null;
  websiteUrl: string | null;
  /*
   * The bill's own number, when the plan carries one.
   *
   * This was removed when the form stopped asking for it, on the reading that
   * the API had no column to answer with — and that reading was already out of
   * date: `2026-08-31-subscription-reference.sql` had added the column and
   * `subscriptions.service.ts` selects it. The consequence was small and
   * invisible: the table's Invoice cell had nothing to render, so it printed a
   * fixed dash on every row while every other money table in the app printed
   * the number or N/A.
   *
   * Read-only from here. The FORM does not ask for it — an invoice is a
   * document, attached — but a number recorded before that, or by the importer,
   * still has to show.
   */
  invoiceNo: string | null;
  reference: string | null;
  /** Derived from the file that points at this row, not a column here. */
  screenshotFileId: string | null;
  /** Invoice and bank record on the plan — not its own screenshot. */
  documentCount: number;
  notes: string | null;
  users: SubscriptionSeatDto[];
};

/**
 * A tool on somebody's profile — the team page's side of the join.
 *
 * The whole plan row, plus what is this person's rather than the plan's. It
 * used to be ten fields of its own, which is why the profile showed four
 * columns where the subscriptions screen shows fourteen; being the same row
 * means the two tables cannot drift apart the next time a field is added.
 */
export type MemberSubscriptionDto = SubscriptionDto & {
  /** Theirs, not the plan's: access can be cancelled while the plan runs on. */
  seatStatus: SubscriptionStatus;
  fromDate: string | null;
  untilDate: string | null;
};

function query(input: Partial<ListSubscriptionsQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export const subscriptionsApi = {
  list: (input: Partial<ListSubscriptionsQuery> = {}) =>
    apiFetch<Paginated<SubscriptionDto>>(
      `/subscriptions?${query({ pageSize: PAGE_SIZE, ...input })}`,
      { cache: "no-store" },
    ),
  get: (id: string) =>
    apiFetch<SubscriptionDto>(`/subscriptions/${id}`, { cache: "no-store" }),
  forMember: (teamMemberId: string) =>
    apiFetch<MemberSubscriptionDto[]>(
      `/subscriptions/for-member/${teamMemberId}`,
      { cache: "no-store" },
    ),
  create: (input: CreateSubscriptionInput) =>
    apiFetch<SubscriptionDto>("/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateSubscriptionInput) =>
    apiFetch<SubscriptionDto>(`/subscriptions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiFetch<void>(`/subscriptions/${id}`, { method: "DELETE" }),
};

export function listSubscriptionFiles(subscriptionId: string) {
  return apiFetch<StoredFile[]>(`/files/subscription/${subscriptionId}`, {
    cache: "no-store",
  });
}

/**
 * The plan screenshot.
 *
 * The kind is singular, so uploading a second one retires the first in the
 * same transaction — there is never a moment with two, and no screen has to
 * decide which is current.
 */
/**
 * The invoice, or the bank's record of the charge.
 *
 * Separate from the screenshot helper because the screenshot's kind is
 * singular — uploading a second retires the first — and these are not: a plan
 * can carry a bill and a bank record at once.
 */
export function uploadSubscriptionFile(
  subscriptionId: string,
  file: File,
  kind: "invoice" | "bank_statement",
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  return apiUpload<StoredFile>(`/files/subscription/${subscriptionId}`, form);
}

export function uploadSubscriptionScreenshot(
  subscriptionId: string,
  file: File,
  label?: string,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "subscription_screenshot");
  if (label) form.append("label", label);
  return apiUpload<StoredFile>(`/files/subscription/${subscriptionId}`, form);
}
