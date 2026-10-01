import { z } from "zod";

/**
 * Settings → Connections: the Google Cloud service account.
 *
 * One key does two jobs (docs/briefs/2026-10-01-google-connections.md): it
 * reaches Claude through Vertex AI when the assistant is set to, and it reads
 * the Google Sheets and Docs the owner shares with it — read-only scopes, so
 * it can never write to them.
 *
 * The key goes one way, in. Nothing the API returns contains it; what comes
 * back is the client email (the address files are shared with) and the
 * project, both of which Google prints on the console anyway.
 */
export const setGoogleKeySchema = z.strictObject({
  /**
   * The JSON file Google downloads, pasted whole. Its shape — `type`,
   * `project_id`, `client_email`, `private_key` — is checked on the server,
   * which says which part is missing.
   */
  serviceAccount: z
    .string()
    .trim()
    .min(2, "Paste the JSON key")
    .max(20_000, "That is far longer than a service-account key"),
});
export type SetGoogleKeyInput = z.infer<typeof setGoogleKeySchema>;

export type GoogleConnection = {
  configured: boolean;
  /** "…@<project>.iam.gserviceaccount.com" — share files with this address. */
  clientEmail: string | null;
  projectId: string | null;
  /** Where Vertex is asked; "global" unless changed. */
  region: string;
  setAt: string | null;
  setBy: string | null;
};

export type GoogleKeyResult = {
  saved: boolean;
  /** Why it was not saved, in words a person can act on. */
  message: string | null;
  connection: GoogleConnection;
};

/** `vertex` is Claude on Vertex AI; `gemini` is Gemini on the same project. */
export const GOOGLE_CHECKS = [
  "vertex",
  "gemini",
  "sheets",
  "docs",
  "drive",
] as const;
export type GoogleCheckId = (typeof GOOGLE_CHECKS)[number];

/** One line of the Test button's answer. */
export type GoogleCheck = {
  id: GoogleCheckId;
  label: string;
  ok: boolean;
  message: string;
};

export type GoogleTestResult = { checks: GoogleCheck[] };
