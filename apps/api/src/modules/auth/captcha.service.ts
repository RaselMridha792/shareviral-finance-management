import { Injectable, Logger } from "@nestjs/common";

/** Cloudflare's own; TURNSTILE_VERIFY_URL exists so "unreachable" can be tested. */
export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Long enough for a slow day at Cloudflare, short enough that nobody waits. */
const TIMEOUT_MS = 5_000;

/**
 * Cloudflare saying this deployment is set up wrong, not that the visitor is
 * a bot. Every sign-in will be refused until somebody fixes the key, so it is
 * logged as an error rather than a warning.
 */
const MISCONFIGURED = new Set(["missing-input-secret", "invalid-input-secret"]);

/**
 * Cloudflare Turnstile, the human check in front of the password.
 *
 * **Off unless TURNSTILE_SECRET_KEY is set.** `enabled` is the only place that
 * decides it, and nothing else in the sign-in path knows: with no key the app
 * signs in exactly as it did before, which is what every harness and local
 * sign-in relies on. Once the key is set, a missing or malformed token is
 * refused — off by configuration must never become off by accident.
 *
 * **It fails closed.** No answer within five seconds, a network error, a
 * non-200: refused. For a payroll app an open door while Cloudflare is down is
 * not a trade worth making. The way out is to take the key off the server's
 * environment and recreate the api container (deploy/.env.example).
 *
 * The secret is sent to Cloudflare and nowhere else — never logged, and never
 * in an error message, which carries the cause and nothing of the request.
 */
@Injectable()
export class CaptchaService {
  private readonly log = new Logger(CaptchaService.name);

  /** Read per call, so a test or a recreated container is never half-on. */
  get enabled(): boolean {
    return Boolean(secretKey());
  }

  /**
   * Whether this sign-in may go on to its password. True whenever the check
   * is off; otherwise only when Cloudflare itself says so.
   */
  async verify(
    token: string | undefined,
    ip: string | null | undefined,
  ): Promise<boolean> {
    const secret = secretKey();
    if (!secret) return true;
    if (!token) return false;

    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);

    try {
      const response = await fetch(verifyUrl(), {
        method: "POST",
        body,
        redirect: "error",
        // Covers reading the body too, not only waiting for the headers.
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.log.warn(
          `Cloudflare answered ${response.status} to a sign-in's human check; the sign-in was refused.`,
        );
        return false;
      }
      const answer = (await response.json()) as {
        success?: unknown;
        "error-codes"?: unknown;
      };
      if (answer.success === true) return true;

      const codes = Array.isArray(answer["error-codes"])
        ? answer["error-codes"].map(String)
        : [];
      if (codes.some((code) => MISCONFIGURED.has(code))) {
        this.log.error(
          `Cloudflare refused TURNSTILE_SECRET_KEY itself (${codes.join(", ")}). Every sign-in is refused until it is corrected or taken off.`,
        );
      } else {
        this.log.warn(
          `A sign-in's human check was refused by Cloudflare (${codes.join(", ") || "no reason given"}).`,
        );
      }
      return false;
    } catch (error) {
      this.log.warn(
        `Cloudflare could not be reached for a sign-in's human check (${describe(error)}); the sign-in was refused.`,
      );
      return false;
    }
  }
}

function secretKey(): string | undefined {
  // Compose names the variable even when it is empty, so "" means off too.
  return process.env.TURNSTILE_SECRET_KEY?.trim() || undefined;
}

function verifyUrl(): string {
  return process.env.TURNSTILE_VERIFY_URL?.trim() || SITEVERIFY_URL;
}

/**
 * Node's fetch says only "fetch failed" for every network failure; what
 * happened is in `cause`. The request body — the secret and the token — is in
 * neither.
 */
function describe(error: unknown): string {
  // By name: the abort is a DOMException, which is not an `Error` in every realm.
  if ((error as { name?: unknown } | null)?.name === "TimeoutError") {
    return `no answer within ${TIMEOUT_MS / 1000}s`;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    const why = cause?.code ?? cause?.message;
    return why
      ? `${error.message}: ${String(why).slice(0, 120)}`
      : error.message;
  }
  return String(error).slice(0, 200);
}
