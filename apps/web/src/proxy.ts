import { hasPermission, type Permission, type Role } from "@finance/shared";
import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "sfm_access";
const REFRESH_COOKIE = "sfm_refresh";
const LOGIN_PATH = "/login";
const NO_ACCESS_PATH = "/no-access";

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4001/api";

/**
 * Keeps signed-out visitors off the app shell, and renews an aged access token
 * before the page under it starts fetching.
 *
 * **This is the only place the token may be refreshed.** Refreshing rotates it:
 * the old one is spent and a new one comes back in a `Set-Cookie`. Anywhere
 * that cannot forward that header to the browser — a Server Component, for
 * instance — silently drops the new token while spending the old one, and the
 * browser's next request presents a token the server has already retired. That
 * looks exactly like a stolen token being replayed, so reuse detection revokes
 * the entire family and the user is signed out for good. The proxy can set
 * cookies on the response, so it is the one layer that can do this safely.
 *
 * The token is not verified here — the signing secret belongs to the API. Only
 * its expiry is read, which is enough to decide whether to renew. Real
 * enforcement stays with the API's guard.
 *
 * (Next 16 renamed `middleware.ts` to `proxy.ts`.)
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const hasRefresh = request.cookies.has(REFRESH_COOKIE);

  if (pathname === NO_ACCESS_PATH) return NextResponse.next();

  if (pathname === LOGIN_PATH) {
    if (access && !isExpired(access)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const usable = access && !isExpired(access);

  if (!usable && hasRefresh) {
    const renewed = await renew(request);
    if (renewed) return renewed;
    // Refresh failed: the session is genuinely over.
    return toLogin(request, pathname, search);
  }

  if (!usable) return toLogin(request, pathname, search);

  const denied = deniedBy(pathname, roleOf(access));
  if (denied) {
    const url = new URL(NO_ACCESS_PATH, request.url);
    url.searchParams.set("from", pathname);
    url.searchParams.set("needs", denied);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * Which permission a page needs, for routing only.
 *
 * **This is not the gate.** The token is not verified here — the signing secret
 * belongs to the API, and the API's guard is what actually refuses. This exists
 * because without it a role that opens a page it cannot read got the fetch's
 * 403 as an unhandled render error: "This page couldn't load — a server error
 * occurred", with an error id. Thirteen routes did that to HR, including one
 * its own sidebar linked to. A permission boundary should read as a boundary,
 * not as a fault.
 *
 * Longest prefix wins, so `/accounts/cash-in` is covered by `/accounts`.
 */
const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/accounts", "accounts.read"],
  ["/transactions", "transactions.read"],
  ["/expenses", "transactions.read"],
  ["/subscriptions", "vendors.read"],
  ["/team", "team.read"],
  ["/payroll", "payroll.read"],
  ["/tax/withholding", "tds.read"],
  ["/reports", "reports.view"],
  // The bank statement is the ledger line for line, not a figure derived from
  // it — so it is gated like the ledger and not like a report.
  ["/statement", "transactions.read"],
  ["/data", "imports.run"],
  // The old path still answers, with a permanent redirect, so it is still
  // gated: an unlisted route is not denied by anything here — `deniedBy`
  // returns null when nothing matches — and letting the refusal happen after
  // the redirect rather than before it is a worse answer to the same question.
  ["/import", "imports.run"],
  ["/assistant", "ai.use"],
  ["/settings", "settings.read"],
];

function deniedBy(pathname: string, role: Role | null): Permission | null {
  if (!role) return null;

  const match = ROUTE_PERMISSIONS.filter(
    ([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/"),
  ).sort((a, b) => b[0].length - a[0].length)[0];

  if (!match) return null;
  return hasPermission(role, match[1]) ? null : match[1];
}

/** The role claim, unverified — see `deniedBy`. */
function roleOf(token: string | undefined): Role | null {
  if (!token) return null;
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: Role };
    return json.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Spends the refresh token and hands the new pair to the browser.
 *
 * The renewed cookies go onto both the outgoing response (so the browser keeps
 * them) and the request headers (so the render happening right now already
 * uses the fresh token instead of 401-ing its way through every fetch).
 */
async function renew(request: NextRequest): Promise<NextResponse | null> {
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        "X-Requested-With": "finance-web",
      },
      cache: "no-store",
    });
  } catch {
    // The API being unreachable is not the same as being signed out; let the
    // page render and fail with a real message rather than bouncing to login.
    return NextResponse.next();
  }

  if (!upstream.ok) return null;

  const setCookies = readSetCookies(upstream);
  if (!setCookies.length) return null;

  const fresh = valueOf(setCookies, ACCESS_COOKIE);
  const headers = new Headers(request.headers);
  if (fresh) {
    headers.set(
      "cookie",
      replaceCookie(headers.get("cookie"), ACCESS_COOKIE, fresh),
    );
  }

  const response = NextResponse.next({ request: { headers } });
  for (const cookie of setCookies)
    response.headers.append("set-cookie", cookie);
  return response;
}

function toLogin(request: NextRequest, pathname: string, search: string) {
  const url = new URL(LOGIN_PATH, request.url);
  // Send them back where they were heading once they sign in.
  if (pathname !== "/") url.searchParams.set("next", pathname + search);

  const response = NextResponse.redirect(url);
  // A dead cookie left in place means the next visit repeats this round trip.
  response.cookies.delete(ACCESS_COOKIE);
  return response;
}

/**
 * Reads `exp` out of a JWT without verifying it.
 *
 * A minute of slack, so a token that dies mid-render is renewed on the way in
 * rather than a moment too late.
 */
function isExpired(token: string): boolean {
  const [, payload] = token.split(".");
  if (!payload) return true;

  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    if (!json.exp) return true;
    return json.exp * 1000 <= Date.now() + 60_000;
  } catch {
    return true;
  }
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function valueOf(setCookies: string[], name: string): string | null {
  for (const cookie of setCookies) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    if (index > 0 && pair.slice(0, index).trim() === name) {
      return pair.slice(index + 1);
    }
  }
  return null;
}

function replaceCookie(
  header: string | null,
  name: string,
  value: string,
): string {
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${name}=`));
  kept.push(`${name}=${value}`);
  return kept.join("; ");
}

export const config = {
  matcher: [
    /**
     * Page routes only.
     *
     * `/api` is excluded and that exclusion is load-bearing: those paths are
     * rewritten straight to the API, which does its own authentication and
     * answers 401 in JSON. Letting this proxy see them means an unauthenticated
     * API call gets a 307 to the login page instead — so every request fails,
     * including the login request itself, which is the one that would have
     * fixed the missing cookie. In development the API sits on another port and
     * never reaches this file, so the whole thing only breaks once deployed.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
