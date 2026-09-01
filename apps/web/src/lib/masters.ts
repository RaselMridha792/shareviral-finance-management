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
  /** The opening in the account's own currency, when somebody has stated it. */
  openingBalanceUsd: string | null;
  openingBalanceOn: string;

  /*
   * A card's readable half. The number and the CVC are NOT here and never
   * will be: the API omits them from its own DTO at the type level, so they
   * are not on the wire to omit. They are read one at a time through
   * POST /accounts/:id/card-secrets, which asks for the card password.
   *
   * `cardLast4` is what the screen shows to tell one card from another.
   */
  cardHolderName: string | null;
  cardLabel: string | null;
  cardLast4: string | null;
  /** MM/YYYY as typed. */
  cardExpiry: string | null;
  cardSecretsSetAt: string | null;
  cardSecretsSetBy: string | null;

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
export type AccountWithBalance = AccountDto & {
  balance: string;
  /** The balance in the account's own currency — dollars summed, not divided. */
  ownBalance: string;
  /** False when some row had no dollars and no rate of its own. */
  ownBalanceExact: boolean;
};

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

/** Whether a card password has been set at all, and when. */
export type CardPasswordStatus = {
  isSet: boolean;
  setAt: string | null;
  setBy: string | null;
};

/** The card, read once, against the card password. Never stored client-side. */
export type CardSecrets = {
  cardNumber: string | null;
  cardCvc: string | null;
};

export const accountsApi = {
  /**
   * The card's own digits, read one request at a time.
   *
   * `POST` rather than `GET`, and the password in the BODY: a query string is
   * written to every access log it passes through. Nothing is created, so the
   * API answers 200.
   *
   * The result is never put in state that outlives the drawer — see the note in
   * `CardDetails`.
   */
  revealCard: (id: string, cardPassword: string) =>
    apiFetch<CardSecrets>(`/accounts/${id}/card-secrets`, {
      method: "POST",
      ...json({ cardPassword }),
    }),

  cardPasswordStatus: () =>
    apiFetch<CardPasswordStatus>("/accounts/card-password", {
      cache: "no-store",
    }),

  /**
   * Set it, or change it.
   *
   * `current` is required once one exists — the server enforces that, and this
   * only carries what was typed. Behind `settings.write`, which is deliberately
   * narrower than reading a card: the people who may USE the password are
   * super_admin, admin and CFO; the person who may CHANGE it for everybody is
   * one.
   */
  setCardPassword: (input: { current?: string | null; next: string }) =>
    apiFetch<CardPasswordStatus>("/accounts/card-password", {
      method: "POST",
      ...json(input),
    }),

  list: (includeInactive = false) =>
    apiFetch<AccountWithBalance[]>(
      `/accounts?includeInactive=${includeInactive}`,
      {
        cache: "no-store",
      },
    ),
  /**
   * One account, with every column - not the narrow projection the register
   * returns. The register only ever needed a name and a currency; the details
   * panel needs branch, routing, SWIFT and the rest.
   */
  get: (id: string) =>
    apiFetch<AccountDto>(`/accounts/${id}`, { cache: "no-store" }),
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
