import { z } from "zod";

/**
 * The five roles the app ships with. Kept here rather than in the API so the
 * frontend can gate navigation with the exact same list the backend enforces.
 */
export const ROLES = ["super_admin", "ceo", "admin", "finance", "hr"] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  ceo: "CEO",
  admin: "Admin",
  finance: "Finance",
  hr: "HR",
};
