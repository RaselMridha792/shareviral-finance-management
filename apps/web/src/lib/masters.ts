import type {
  AccountType,
  BillingCycle,
  CategoryKind,
  CreateAccountInput,
  CreateCategoryInput,
  CreateVendorInput,
  LockBooksInput,
  Paginated,
  PsrStatus,
  SubscriptionSummary,
  UpdateAccountInput,
  UpdateCategoryInput,
  UpdateSettingsInput,
  UpdateVendorInput,
  VendorType,
} from "@finance/shared";

import type { AppSettingsDto } from "@/components/settings-provider";
import { apiFetch } from "./api-client";

/* -------------------------------------------------------------------------- */
/*  Types the API returns                                                      */
/* -------------------------------------------------------------------------- */

export type AccountDto = {
  id: string;
  name: string;
  type: AccountType;
  bankName: string | null;
  branch: string | null;
  accountNumber: string | null;
  routingNumber: string | null;
  swiftCode: string | null;
  currency: string;
  /** The figure the books were opened at. It never changes. */
  openingBalance: string;
  openingBalanceOn: string;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
};

/**
 * An account with what it holds now: the opening figure plus every entry
 * against it, voided rows excluded. The API computes it, so this and the
 * dashboard cannot arrive at different answers.
 *
 * A separate type rather than an optional field on `AccountDto`. Optional
 * would compile everywhere and produce `NaN` in the total the first time a
 * response without it reached the screen — a money figure that renders as
 * nothing, from code that type-checked.
 */
export type AccountWithBalance = AccountDto & { balance: string };

export type CategoryDto = {
  id: string;
  name: string;
  slug: string;
  kind: CategoryKind;
  parentId: string | null;
  color: string;
  sortOrder: number;
  isSystem: boolean;
  isActive: boolean;
};

export type CategoryNode = CategoryDto & { children: CategoryDto[] };

export type VendorDto = {
  id: string;
  name: string;
  type: VendorType;
  etin: string | null;
  bin: string | null;
  psrStatus: PsrStatus;
  psrAssessmentYear: string | null;
  psrReference: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  defaultCategoryId: string | null;

  /**
   * What it usually costs and how often it tends to be bought — context, not
   * a schedule. Nothing is due because of these; what was actually paid comes
   * from the ledger, via `vendorsApi.subscriptions()`.
   */
  billingCycle: BillingCycle;
  billingAmount: string | null;
  billingCurrency: string;
  billingAccountId: string | null;

  notes: string | null;
  isActive: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Calls                                                                      */
/* -------------------------------------------------------------------------- */

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const settingsApi = {
  get: () => apiFetch<AppSettingsDto>("/settings", { cache: "no-store" }),
  update: (input: UpdateSettingsInput) =>
    apiFetch<AppSettingsDto>("/settings", { method: "PATCH", ...json(input) }),
  lockBooks: (input: LockBooksInput) =>
    apiFetch<AppSettingsDto>("/settings/lock-books", {
      method: "POST",
      ...json(input),
    }),
};

export const accountsApi = {
  list: (includeInactive = false) =>
    apiFetch<AccountWithBalance[]>(`/accounts?includeInactive=${includeInactive}`, {
      cache: "no-store",
    }),
  create: (input: CreateAccountInput) =>
    apiFetch<AccountDto>("/accounts", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateAccountInput) =>
    apiFetch<AccountDto>(`/accounts/${id}`, {
      method: "PATCH",
      ...json(input),
    }),
  archive: (id: string) =>
    apiFetch<AccountDto>(`/accounts/${id}/archive`, { method: "POST" }),
  restore: (id: string) =>
    apiFetch<AccountDto>(`/accounts/${id}/restore`, { method: "POST" }),
  /** Read before the confirmation is drawn, so it can name figures. */
  attachments: (id: string) =>
    apiFetch<AccountAttachments>(`/accounts/${id}/attachments`, {
      cache: "no-store",
    }),
  remove: (id: string) =>
    apiFetch<AccountDto>(`/accounts/${id}`, { method: "DELETE" }),
};

/** What points at an account. Mirrors the API's own type. */
export type AccountAttachments = {
  transactions: number;
  liveTransactions: number;
  firstTxnDate: string | null;
  lastTxnDate: string | null;
  net: string;
  tdsDeposits: number;
  incomeTaxPayments: number;
  payrollRuns: number;
  deletable: boolean;
};

export const categoriesApi = {
  tree: (includeInactive = false) =>
    apiFetch<CategoryNode[]>(
      `/categories/tree?includeInactive=${includeInactive}`,
      { cache: "no-store" },
    ),
  create: (input: CreateCategoryInput) =>
    apiFetch<CategoryDto>("/categories", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateCategoryInput) =>
    apiFetch<CategoryDto>(`/categories/${id}`, {
      method: "PATCH",
      ...json(input),
    }),
};

export const vendorsApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      q?: string;
      includeInactive?: boolean;
    } = {},
  ) => {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("pageSize", String(params.pageSize ?? 25));
    if (params.q) search.set("q", params.q);
    if (params.includeInactive) search.set("includeInactive", "true");
    return apiFetch<Paginated<VendorDto>>(`/vendors?${search}`, {
      cache: "no-store",
    });
  },
  /**
   * Every AI tool and subscription, with what was actually paid in a month.
   *
   * Year and month go together or not at all — omitting both means the current
   * Dhaka month, which is what the page opens on.
   */
  subscriptions: (params: { year?: number; month?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.year && params.month) {
      search.set("year", String(params.year));
      search.set("month", String(params.month));
    }
    const qs = search.toString();
    return apiFetch<SubscriptionSummary>(
      `/vendors/subscriptions${qs ? `?${qs}` : ""}`,
      { cache: "no-store" },
    );
  },

  create: (input: CreateVendorInput) =>
    apiFetch<VendorDto>("/vendors", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateVendorInput) =>
    apiFetch<VendorDto>(`/vendors/${id}`, { method: "PATCH", ...json(input) }),
};
