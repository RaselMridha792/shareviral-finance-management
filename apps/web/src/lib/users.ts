import type {
  CreateUserInput,
  Paginated,
  ResetPasswordInput,
  UpdateUserInput,
  UserDto,
} from "@finance/shared";

import { apiFetch } from "./api-client";

const json = (body: unknown) => ({ body: JSON.stringify(body) });

/** Super Admin only — every one of these answers 403 for anybody else. */
export const usersApi = {
  list: (params: { q?: string; role?: string; status?: string } = {}) => {
    const search = new URLSearchParams({ page: "1", pageSize: "100" });
    if (params.q) search.set("q", params.q);
    if (params.role) search.set("role", params.role);
    if (params.status) search.set("status", params.status);
    return apiFetch<Paginated<UserDto>>(`/users?${search}`, {
      cache: "no-store",
    });
  },
  create: (input: CreateUserInput) =>
    apiFetch<UserDto>("/users", { method: "POST", ...json(input) }),
  update: (id: string, input: UpdateUserInput) =>
    apiFetch<UserDto>(`/users/${id}`, { method: "PATCH", ...json(input) }),
  resetPassword: (id: string, input: ResetPasswordInput) =>
    apiFetch<{ reset: boolean }>(`/users/${id}/reset-password`, {
      method: "POST",
      ...json(input),
    }),
};
