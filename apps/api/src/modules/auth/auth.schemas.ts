import { z } from "zod";

export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters")
      .max(200, "That is too long"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/* -------------------------------------------------------------------------- */
/*  Two-factor                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Six digits from the phone, or a sixteen-character recovery code.
 *
 * Kept loose on purpose — the service decides which it is. Pinning the shape
 * here would mean a recovery code typed into the box marked "code" is rejected
 * by validation with a message about digits, at exactly the moment somebody has
 * lost their phone and is already having a bad day.
 */
export const twoFactorCodeSchema = z
  .string()
  .trim()
  .min(6, "Enter the code from your authenticator app")
  .max(40, "That is too long to be a code");

/** The password again, because re-enrolling silently is an attack. */
export const beginTwoFactorSetupSchema = z.strictObject({
  password: z.string().min(1, "Enter your password"),
});
export type BeginTwoFactorSetupInput = z.infer<
  typeof beginTwoFactorSetupSchema
>;

export const confirmTwoFactorSchema = z.strictObject({
  code: twoFactorCodeSchema,
});
export type ConfirmTwoFactorInput = z.infer<typeof confirmTwoFactorSchema>;

/** Both, for anything that weakens the account or reissues its codes. */
export const twoFactorPasswordAndCodeSchema = z.strictObject({
  password: z.string().min(1, "Enter your password"),
  code: twoFactorCodeSchema,
});
export type TwoFactorPasswordAndCodeInput = z.infer<
  typeof twoFactorPasswordAndCodeSchema
>;
