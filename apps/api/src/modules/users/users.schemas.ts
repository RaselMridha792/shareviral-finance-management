import { paginationQuerySchema, roleSchema } from "@finance/shared";
import { z } from "zod";

export const createUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  role: roleSchema,
  password: z
    .string()
    .min(12, "Use at least 12 characters")
    .max(200, "That is too long"),
  mustChangePassword: z.boolean().default(true),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .strictObject({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: roleSchema.optional(),
    status: z.enum(["active", "invited", "disabled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Nothing to change",
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.strictObject({
  newPassword: z.string().min(12, "Use at least 12 characters").max(200),
  mustChangePassword: z.boolean().default(true),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  role: roleSchema.optional(),
  status: z.enum(["active", "invited", "disabled"]).optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
