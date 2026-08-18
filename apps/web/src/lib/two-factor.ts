import { apiFetch } from "./api-client";

export type TwoFactorStatus = {
  enrolled: boolean;
  confirmedAt: string | null;
  recoveryCodesLeft: number;
};

export type TwoFactorSetup = {
  /** Shown for typing in by hand when a camera is not an option. */
  secret: string;
  otpauthUrl: string;
  /**
   * Inert markup: rectangles and a path, asserted server-side to carry no
   * script, no text nodes, and neither the secret nor the URL. That is what
   * makes rendering it with dangerouslySetInnerHTML defensible.
   */
  qrSvg: string;
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const twoFactorApi = {
  status: () =>
    apiFetch<TwoFactorStatus>("/auth/2fa", { cache: "no-store" }),

  /** Returns the secret once. Closing the page means starting again. */
  beginSetup: (password: string) =>
    apiFetch<TwoFactorSetup>("/auth/2fa/setup", {
      method: "POST",
      ...json({ password }),
    }),

  confirm: (code: string) =>
    apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/confirm", {
      method: "POST",
      ...json({ code }),
    }),

  disable: (password: string, code: string) =>
    apiFetch<{ disabled: true }>("/auth/2fa/disable", {
      method: "POST",
      ...json({ password, code }),
    }),

  regenerateRecoveryCodes: (password: string, code: string) =>
    apiFetch<{ recoveryCodes: string[] }>("/auth/2fa/recovery-codes", {
      method: "POST",
      ...json({ password, code }),
    }),
};
