import { z } from "zod";

/**
 * The six roles the app ships with. Kept here rather than in the API so the
 * frontend can gate navigation with the exact same list the backend enforces.
 *
 * `cfo` is last on purpose. This array's order is the Postgres `user_role`
 * enum's declaration order, and a value added to a Postgres enum can only go
 * on the end without rewriting the type — so a new role appends here, whatever
 * seniority might suggest.
 */
export const ROLES = [
  "super_admin",
  "ceo",
  "admin",
  "finance",
  "hr",
  "cfo",
] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  ceo: "CEO",
  admin: "Admin",
  finance: "Finance",
  hr: "HR",
  cfo: "CFO",
};
