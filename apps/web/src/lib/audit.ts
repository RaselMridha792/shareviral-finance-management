import type {
  AuditAction,
  AuditActor,
  AuditEntryDto,
  Paginated,
} from "@finance/shared";

import { apiFetch } from "./api-client";

export type AuditFilters = {
  from?: string;
  to?: string;
  action?: AuditAction;
  module?: string;
  actorUserId?: string;
  q?: string;
};

const fresh = { cache: "no-store" as const };

export const auditApi = {
  list: (filters: AuditFilters = {}, page = 1) => {
    const search = new URLSearchParams({
      page: String(page),
      pageSize: "50",
    });
    for (const [key, value] of Object.entries(filters)) {
      if (value) search.set(key, value);
    }
    return apiFetch<Paginated<AuditEntryDto>>(`/audit?${search}`, fresh);
  },

  filters: () =>
    apiFetch<{ modules: string[]; actors: AuditActor[] }>(
      "/audit/filters",
      fresh,
    ),

  history: (entityTable: string, entityId: string) =>
    apiFetch<AuditEntryDto[]>(`/audit/${entityTable}/${entityId}`, fresh),
};
