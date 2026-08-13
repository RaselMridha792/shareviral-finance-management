import type {
  AccountType,
  CategoryKind,
  CreateAccountInput,
  CreateCategoryInput,
  CreateVendorInput,
  LockBooksInput,
  Paginated,
  PsrStatus,
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
  currency: string;
  openingBalance: string;
  openingBalanceOn: string;
  sortOrder: number;
  isActive: boolean;
  notes: string | null;
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
    apiFetch<AccountDto[]>(`/accounts?includeInactive=${includeInactive}`, {
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
  create: (input: CreateVendorInput) =>
    apiFetch<VendorDto>("/vendors", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateVendorInput) =>
    apiFetch<VendorDto>(`/vendors/${id}`, { method: "PATCH", ...json(input) }),
};
