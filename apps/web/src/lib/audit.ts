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

import { PAGE_SIZE } from "@/lib/pagination";

const fresh = { cache: "no-store" as const };

export const auditApi = {
  list: (filters: AuditFilters = {}, page = 1) => {
    const search = new URLSearchParams({
      page: String(page),
      // Must be PAGE_SIZE, not a number of its own. `serial()` computes a
      // row's number as (page - 1) * PAGE_SIZE + index, so a request for 50
      // and a serial counted in 20s disagree from page two onward — the
      // fifty-first entry rendered as "21". Two different rows, one number, on
      // the screen whose entire job is saying which record changed.
      pageSize: String(PAGE_SIZE),
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
