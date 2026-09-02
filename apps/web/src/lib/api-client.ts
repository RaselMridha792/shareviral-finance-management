/**
 * The only place the frontend talks to the backend.
 *
 * The browser never touches the database — everything goes through the NestJS
 * API at API_URL. Keep fetch calls out of components and add typed helpers here.
 */

import type { Permission, Role } from "@finance/shared";

// 4001, not 4000 — 4000 is commonly occupied (Local by Flywheel). In production
// both apps sit behind one nginx, so this is same-origin "/api".
const BASE_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4001/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Server Components don't carry the browser's cookies automatically, so on the
 * server we read them and forward them explicitly. In the browser
 * `credentials: "include"` does it.
 */
async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const cookie = jar.toString();
  return cookie ? { cookie } : {};
}

async function request(path: string, init: RequestInit): Promise<Response> {
  /*
   * `Headers`, not an object literal, and that is a bug fix rather than taste.
   *
   * Header names are case-insensitive on the wire and case-*sensitive* as
   * object keys. Spreading `{"Content-Type": ...}` and a caller's
   * `{"content-type": ...}` therefore produced two entries rather than one, and
   * `fetch` joins same-named headers with a comma — so the request went out as
   * `content-type: application/json, application/json`, which no JSON body
   * parser matches. The server saw no body at all: `@Body()` arrived as
   * `undefined` and the handler died reading a field off it.
   *
   * It only bit the two calls that spelled the header in lower case, and only
   * in a browser, which is why it survived a run through the API by hand.
   * `Headers.set` replaces by normalised name, so the spelling stops mattering.
   */
  const headers = new Headers({
    "Content-Type": "application/json",
    // Cookie auth needs a CSRF countermeasure: this header can't be set by a
    // cross-origin form post, and the API rejects mutations without it.
    "X-Requested-With": "finance-web",
  });

  for (const [name, value] of Object.entries(await authHeaders())) {
    headers.set(name, value);
  }
  if (init.headers) {
    new Headers(init.headers).forEach((value, name) =>
      headers.set(name, value),
    );
  }

  // A multipart upload has to carry the boundary the browser generates, and it
  // only does that when nothing has already claimed the header.
  if (init.body instanceof FormData) headers.delete("Content-Type");

  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    // Both auth cookies are httpOnly.
    credentials: "include",
  });
}

async function toError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    errors?: Record<string, string[]>;
  } | null;

  /*
   * "Validation failed" is the envelope, not the answer.
   *
   * The API's validation pipe wraps every field problem in that one sentence
   * and puts the real ones in `errors` — and any screen that prints only
   * `message` shows the envelope. Screens that render field-level errors keep
   * doing so through `fieldErrors`; this only rescues the message for the
   * screens that do not, so "Validation failed" with the reason a click away
   * becomes the reason itself.
   */
  const firstFieldError = body?.errors
    ? Object.values(body.errors).flat()[0]
    : undefined;
  const message =
    body?.message && body.message !== "Validation failed"
      ? body.message
      : (firstFieldError ??
        body?.message ??
        `Request failed (${response.status})`);

  return new ApiError(message, response.status, body?.errors);
}

/**
 * The access token lives ~15 minutes but its cookie lasts days, so a 401 here
 * usually means "the token aged out", not "signed out". Refresh once and retry
 * before giving up — otherwise the user is thrown to the login screen every
 * quarter of an hour.
 *
 * If the retry is still a 401 the session really is over, and the honest
 * response is the login page. Throwing instead surfaced a raw "Session
 * expired" error overlay, because a page's own fetches run alongside the
 * layout's session check rather than after it — so the layout's redirect never
 * got the chance to happen.
 *
 * Pass `allow401` when the caller wants to decide for itself; `getSession`
 * does, since its whole job is to answer "is anyone signed in".
 */
/**
 * Where a 401 is the answer, not a stale session.
 *
 * Two things above key off this, and both would misbehave on the sign-in
 * endpoints:
 *
 *  - The retry. A 401 normally means the access token aged out, so the client
 *    refreshes and sends the request again. Replaying `2fa/verify` would submit
 *    the same wrong code a second time, and wrong codes are counted - five and
 *    the account is locked. One typo would spend two of the five.
 *  - The redirect. Bouncing to /login on a 401 is right for an expired session
 *    and useless here: it throws away the message explaining what to fix, on
 *    the very screen that exists to say it.
 *
 * `/auth/refresh` is in the set for its own reason - refreshing after a failed
 * refresh is a loop.
 */
const SIGNING_IN = new Set([
  "/auth/login",
  "/auth/2fa/verify",
  "/auth/refresh",
]);

/**
 * One refresh at a time, however many requests 401 together.
 *
 * A screen left open past the access token's quarter of an hour fires all of
 * its fetches at once when it is touched again, and every one of them gets a
 * 401. Without this each would refresh on its own: the first rotates the
 * token, the rest arrive holding the one it just replaced, and the API — quite
 * correctly, from where it stands — reads that as a replay. The server now has
 * a grace window for exactly this, but the honest fix is not to make the noise
 * in the first place: whoever asks second waits for the answer the first is
 * already getting.
 */
let refreshInFlight: Promise<Response> | null = null;

function refreshOnce(): Promise<Response> {
  refreshInFlight ??= request("/auth/refresh", { method: "POST" }).finally(
    () => {
      refreshInFlight = null;
    },
  );
  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { allow401?: boolean } = {},
): Promise<T> {
  const { allow401, ...rest } = init;
  let response = await request(path, rest);

  // Only in the browser. On the server the rotated token comes back in a
  // `Set-Cookie` this code cannot forward to the browser, so refreshing here
  // spends the token and leaves the browser holding a retired one — which
  // reuse detection then treats as a replay and revokes the whole family. The
  // proxy renews the token before the render starts instead.
  const inBrowser = typeof window !== "undefined";

  if (inBrowser && response.status === 401 && !SIGNING_IN.has(path)) {
    const refreshed = await refreshOnce();
    if (refreshed.ok) {
      response = await request(path, rest);
    }
  }

  if (response.status === 401 && !allow401 && !SIGNING_IN.has(path)) {
    await goToLogin();
  }

  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/**
 * Never returns — `redirect()` throws a control-flow signal Next.js unwinds,
 * and a full page load in the browser stops everything after it.
 */
async function goToLogin(): Promise<never> {
  if (typeof window !== "undefined") {
    const here = window.location.pathname + window.location.search;
    window.location.href =
      here && here !== "/"
        ? `/login?next=${encodeURIComponent(here)}`
        : "/login";
    // The navigation is asynchronous; nothing after this should run.
    await new Promise(() => {});
  }

  const { redirect } = await import("next/navigation");
  redirect("/login");
  throw new ApiError("Session expired", 401);
}

/* -------------------------------------------------------------------------- */
/*  Auth                                                                       */
/* -------------------------------------------------------------------------- */

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
  permissions: Permission[];
};

/**
 * A password now buys one of two things, so the caller has to look at which.
 *
 * `twoFactorRequired` comes back for accounts that have enrolled, and there is
 * no session behind it - no cookie has been set. The challenge is handed to
 * `verifySecondStep` along with the code.
 */
export type LoginOutcome =
  | ({ twoFactorRequired?: undefined } & SessionUser)
  | { twoFactorRequired: true; challenge: string };

export function login(email: string, password: string) {
  return apiFetch<LoginOutcome>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/**
 * The challenge is held in memory by the page and posted back here, never
 * stored. It is a credential with five minutes to live; putting it in
 * localStorage would leave it lying around for a script to find, and in a
 * cookie the browser would attach it to requests nobody asked it to.
 */
export function verifySecondStep(challenge: string, code: string) {
  return apiFetch<SessionUser>("/auth/2fa/verify", {
    method: "POST",
    body: JSON.stringify({ challenge, code }),
  });
}

export function logout() {
  return apiFetch<{ signedOut: boolean }>("/auth/logout", { method: "POST" });
}

/** Returns null when nobody is signed in, rather than redirecting. */
export async function getSession(): Promise<SessionUser | null> {
  try {
    return await apiFetch<SessionUser>("/auth/me", {
      cache: "no-store",
      allow401: true,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export type ApiHealth = {
  status: "ok" | "not_configured" | "error";
  database?: string;
  now?: string | null;
  message?: string;
};

/** Returns null when the API itself is unreachable. */
export async function fetchDatabaseHealth(): Promise<ApiHealth | null> {
  try {
    return await apiFetch<ApiHealth>("/health/db", { cache: "no-store" });
  } catch {
    return null;
  }
}

export { BASE_URL as API_BASE_URL };

/* -------------------------------------------------------------------------- */
/*  Files                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The API as the *browser* must address it, which is not always `BASE_URL`.
 *
 * On the server `BASE_URL` is the internal `http://api:4001/api`, reachable
 * only from inside the Docker network. A URL rendered into an `<img src>` is
 * fetched by the browser, so it has to be the public hostname or the picture
 * is a broken icon on every profile — and only in production, where the two
 * values differ.
 */
const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4001/api";

/** Where the bytes of a stored file are, for the browser. */
export function fileHref(fileId: string): string {
  return `${PUBLIC_BASE_URL}/files/${fileId}/content`;
}

/**
 * Multipart upload.
 *
 * Deliberately not `apiFetch`: that sets `Content-Type: application/json` on
 * every request, and a multipart body needs the browser to write the header
 * itself so it can include the boundary it generated. Setting it by hand
 * produces a request the server cannot split back into fields, and the error
 * arrives as a confusing "no file was sent".
 *
 * This posts straight to the API's own hostname. Worth knowing why: the app
 * origin also forwards `/api`, and Next buffers a proxied body with a 10 MB
 * default ceiling — a 15 MB CV sent that way is silently truncated. Going
 * direct means nginx's 25 MB limit is the only one in the path.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const send = () =>
    fetch(`${PUBLIC_BASE_URL}${path}`, {
      method: "POST",
      body: form,
      headers: { "X-Requested-With": "finance-web" },
      credentials: "include",
    });

  let response = await send();

  if (response.status === 401) {
    const refreshed = await fetch(`${PUBLIC_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "X-Requested-With": "finance-web" },
      credentials: "include",
    });
    if (refreshed.ok) response = await send();
  }

  if (!response.ok) throw await toError(response);
  return response.json() as Promise<T>;
}

export type StoredFile = {
  id: string;
  kind: string;
  label: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: string;
  url: string;
};

export function listTeamMemberFiles(memberId: string) {
  return apiFetch<StoredFile[]>(`/files/team-member/${memberId}`, {
    cache: "no-store",
  });
}

export function uploadTeamMemberFile(
  memberId: string,
  file: File,
  kind: string,
  label?: string,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (label) form.append("label", label);
  return apiUpload<StoredFile>(`/files/team-member/${memberId}`, form);
}

export function listTransactionFiles(transactionId: string) {
  return apiFetch<StoredFile[]>(`/files/transaction/${transactionId}`, {
    cache: "no-store",
  });
}

export function uploadTransactionFile(
  transactionId: string,
  file: File,
  kind: string,
  label?: string,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  if (label) form.append("label", label);
  return apiUpload<StoredFile>(`/files/transaction/${transactionId}`, form);
}

/**
 * The company's signature. No id in the path: there is one settings row, and a
 * 1 in a URL is an invitation to try a 2.
 */
export function listSignature() {
  return apiFetch<StoredFile[]>("/files/signature", { cache: "no-store" });
}

export function uploadSignature(file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "signature");
  return apiUpload<StoredFile>("/files/signature", form);
}

export function deleteStoredFile(fileId: string) {
  return apiFetch<void>(`/files/${fileId}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/*  Email                                                                      */
/* -------------------------------------------------------------------------- */

export type NotificationLogRow = {
  id: string;
  kind: string;
  subjectId: string | null;
  subjectDate: string | null;
  recipient: string;
  sentAt: string;
  outcome: string;
  error: string | null;
};

export type EmailStatus = {
  configured: boolean;
  keySetAt: string | null;
  from: string | null;
  adminAddress: string | null;
  enabled: boolean;
  /** Whether reminders also reach the people who can sign in. */
  toStaff: boolean;
  /** Null when it can send; otherwise the one thing still missing. */
  blockedBy: string | null;
  recent: NotificationLogRow[];
};

export const emailApi = {
  status: () => apiFetch<EmailStatus>("/email/status", { cache: "no-store" }),
  setKey: (apiKey: string) =>
    apiFetch<{ saved: boolean; message: string | null }>("/email/key", {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    }),
  clearKey: () =>
    apiFetch<{ saved: boolean }>("/email/key", { method: "DELETE" }),
  update: (input: {
    from?: string;
    adminAddress?: string;
    enabled?: boolean;
    toStaff?: boolean;
  }) =>
    apiFetch<{ saved: boolean }>("/email/settings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  test: () =>
    apiFetch<{ sent: boolean; message: string }>("/email/test", {
      method: "POST",
    }),
  runReminders: () =>
    apiFetch<{ sent: number; message: string }>("/email/run-reminders", {
      method: "POST",
    }),
};

/* -------------------------------------------------------------------------- */
/*  Notifications                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One row of the bell.
 *
 * Not the same thing as `NotificationLogRow` above, and the difference is the
 * `readAt`: that one records that a message left the building, this one records
 * whether *this person* has seen it.
 */
export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationSwitches = {
  renewals: boolean;
  tdsDeadline: boolean;
  payrollUnpaid: boolean;
  significantChanges: boolean;
};

export const notificationsApi = {
  list: () =>
    apiFetch<{ items: NotificationRow[]; unread: number }>("/notifications", {
      cache: "no-store",
    }),
  read: (id: string) =>
    apiFetch<{ marked: boolean }>(`/notifications/${id}/read`, {
      method: "POST",
    }),
  readAll: () =>
    apiFetch<{ marked: number }>("/notifications/read-all", { method: "POST" }),
  settings: () =>
    apiFetch<NotificationSwitches>("/notifications/settings", {
      cache: "no-store",
    }),
  updateSettings: (input: Partial<NotificationSwitches>) =>
    apiFetch<{ saved: boolean }>("/notifications/settings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  run: () =>
    apiFetch<{ raised: number; message: string }>("/notifications/run", {
      method: "POST",
    }),
};

/* -------------------------------------------------------------------------- */
/*  The trash                                                                 */
/* -------------------------------------------------------------------------- */

export type TrashKindSummary = {
  kind: string;
  label: string;
  plural: string;
  count: number;
};

export type TrashItem = {
  kind: string;
  kindLabel: string;
  id: string;
  title: string;
  detail: string | null;
  occurredAt: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
};

/**
 * A subscription's payments.
 *
 * On its own object rather than folded into `vendorsApi`, because a payment is
 * not a change to the plan — it is an entry in the ledger that happens to be
 * addressed by the plan's id.
 */
export const subscriptionsApi = {
  pay: (
    id: string,
    body: {
      txnDate: string;
      amount?: string;
      accountId?: string;
      /* Optional. The server works it out — every payment through this door is
         a subscription payment, so the heading was always the same answer. */
      categoryId?: string;
      note?: string | null;
      advanceRenewal?: boolean;
    },
  ) =>
    apiFetch<{ id: string; refNo: string }>(`/subscriptions/${id}/pay`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const trashApi = {
  summary: () =>
    apiFetch<TrashKindSummary[]>("/trash/summary", { cache: "no-store" }),
  list: (query: { kind?: string; page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.kind) params.set("kind", query.kind);
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return apiFetch<{
      items: TrashItem[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/trash${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  },
  /** Move a row to the trash. The row survives; its visibility does not. */
  remove: (kind: string, id: string, reason: string) =>
    apiFetch<{ deleted: number }>(`/trash/${kind}/${id}`, {
      method: "POST",
      body: JSON.stringify({ reason: reason || null }),
    }),
  /**
   * The same act, on a ticked list.
   *
   * All-or-nothing: the server refuses the whole request if any row cannot go,
   * and names which. A partial delete reads as success and leaves the reader to
   * work out which of forty rows survived.
   */
  removeMany: (kind: string, ids: string[], reason: string) =>
    apiFetch<{ ticked: number; deleted: number }>(`/trash/${kind}/bulk`, {
      method: "POST",
      body: JSON.stringify({ ids, reason: reason || null }),
    }),
  restore: (kind: string, id: string) =>
    apiFetch<{ restored: number }>(`/trash/${kind}/${id}/restore`, {
      method: "POST",
    }),
  /**
   * Restore or purge a ticked list.
   *
   * These report what happened rather than refusing the lot, unlike
   * `removeMany`. A half-restore is not a trap: what did not come back is
   * still in the trash, visibly, and can be tried again — whereas a
   * half-delete reads as success.
   */
  restoreMany: (kind: string, ids: string[]) =>
    apiFetch<{ done: number; failed: { id: string; reason: string }[] }>(
      `/trash/${kind}/bulk-restore`,
      { method: "POST", body: JSON.stringify({ ids }) },
    ),
  purgeMany: (kind: string, ids: string[]) =>
    apiFetch<{ done: number; failed: { id: string; reason: string }[] }>(
      `/trash/${kind}/bulk-purge`,
      { method: "POST", body: JSON.stringify({ ids }) },
    ),
  /** Gone for good. Only answers for a row already in the trash. */
  purge: (kind: string, id: string) =>
    apiFetch<{ purged: number }>(`/trash/${kind}/${id}`, { method: "DELETE" }),
  empty: () => apiFetch<{ purged: number }>("/trash", { method: "DELETE" }),
};
