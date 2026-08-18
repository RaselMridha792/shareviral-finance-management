import type {
  BillingCycle,
  CreateSubscriptionInput,
  ListSubscriptionsQuery,
  Paginated,
  SubscriptionCategory,
  SubscriptionStatus,
  UpdateSubscriptionInput,
} from "@finance/shared";

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
  vendorId: string;
  vendorName: string;
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
  /** Derived from the file that points at this row, not a column here. */
  screenshotFileId: string | null;
  notes: string | null;
  users: SubscriptionSeatDto[];
};

/** A tool on somebody's profile — the team page's side of the join. */
export type MemberSubscriptionDto = {
  subscriptionId: string;
  planName: string;
  vendorName: string;
  category: SubscriptionCategory;
  costUsd: string;
  billingCycle: BillingCycle;
  /** Theirs, not the plan's: access can be cancelled while the plan runs on. */
  status: SubscriptionStatus;
  planStatus: SubscriptionStatus;
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
      `/subscriptions?${query({ pageSize: 50, ...input })}`,
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
