import type {
  GoogleConnection,
  GoogleKeyResult,
  GoogleTestResult,
} from "@finance/shared";

import { apiFetch } from "./api-client";

/**
 * Settings → Connections (#131).
 *
 * The key travels one way. Nothing this module receives ever contains it —
 * only the client email and the project, which Google prints on its own
 * console anyway.
 */
export const connectionsApi = {
  google: () =>
    apiFetch<GoogleConnection>("/connections/google", { cache: "no-store" }),

  setGoogleKey: (serviceAccount: string) =>
    apiFetch<GoogleKeyResult>("/connections/google/key", {
      method: "POST",
      body: JSON.stringify({ serviceAccount }),
    }),

  clearGoogleKey: () =>
    apiFetch<GoogleConnection>("/connections/google/key", {
      method: "DELETE",
    }),

  testGoogle: () =>
    apiFetch<GoogleTestResult>("/connections/google/test", { method: "POST" }),
};
