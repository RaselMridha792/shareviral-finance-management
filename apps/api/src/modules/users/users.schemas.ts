/**
 * Moved to `@finance/shared` so the Super Admin's user form validates against
 * the same rules the API enforces. Re-exported here because the service and
 * controller already import from this path.
 */
export {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type ResetPasswordInput,
  type UpdateUserInput,
} from "@finance/shared";
