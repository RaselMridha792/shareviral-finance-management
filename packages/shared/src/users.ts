import { z } from "zod";

import { paginationQuerySchema } from "./pagination.ts";
import { roleSchema, type Role } from "./roles.ts";

/**
 * Who can sign in. Super Admin only — `users.manage` is granted to no other
 * role, because the ability to create an account is the ability to grant
 * yourself any permission in the app.
 */

export const USER_STATUSES = ["active", "invited", "disabled"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

/**
 * Twelve characters, and nothing else.
 *
 * No character-class rules: they push people toward `Password1!` and away from
 * length, which is the part that actually matters. The real protections are
 * elsewhere — bcrypt at cost 12, lockout after repeated failures, and a forced
 * change at first sign-in.
 */
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters")
  .max(200, "That is too long");

export const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  role: roleSchema,
  password: passwordSchema,
  /** Off only for an account nobody else will ever hold. */
  mustChangePassword: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .strictObject({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: roleSchema.optional(),
    status: userStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.strictObject({
  newPassword: passwordSchema,
  mustChangePassword: z.boolean().default(true),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/**
 * Exactly what `/users` returns — no password hash, no lockout counters, and
 * nothing the screen does not show. Listing a field here that the API never
 * sends is how a UI ends up rendering `undefined`.
 */
export type UserDto = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  /** ISO timestamp, or null if they have never signed in. */
  lastLoginAt: string | null;
  createdAt: string;
};

/**
 * A password nobody has to invent.
 *
 * Left to themselves people reuse one they already have, which is the failure
 * this is here to avoid. Ambiguous characters are left out so it survives being
 * read aloud or written on paper and handed over.
 */
export function suggestPassword(length = 16): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes =
    typeof globalThis.crypto !== "undefined"
      ? globalThis.crypto.getRandomValues(new Uint8Array(length))
      : new Uint8Array(length).map(() => Math.floor(Math.random() * 256));

  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
