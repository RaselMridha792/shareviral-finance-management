import { Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import {
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ACCESS_COOKIE } from "../../common/guards/jwt-auth.guard";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import {
  beginTwoFactorSetupSchema,
  changePasswordSchema,
  confirmTwoFactorSchema,
  loginSchema,
  twoFactorPasswordAndCodeSchema,
  type BeginTwoFactorSetupInput,
  type ChangePasswordInput,
  type ConfirmTwoFactorInput,
  type LoginInput,
  type TwoFactorPasswordAndCodeInput,
} from "./auth.schemas";
import type { IssuedTokens } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

export const REFRESH_COOKIE = "sfm_refresh";
/**
 * Site-wide, not `/api/auth`.
 *
 * The narrow path kept the refresh token off ordinary API calls, which was
 * worth something — but it also meant the browser never sent it on a *page*
 * request, so the one layer that can safely rotate the token (the web app's
 * proxy, which can put the new cookie on the response the browser receives)
 * could not see it. The alternative was refreshing inside a Server Component,
 * which spends the token and drops its replacement, and ends with reuse
 * detection revoking the session.
 *
 * What actually protects the token is unchanged: httpOnly puts it out of
 * script's reach, `sameSite: "lax"` keeps it off cross-site requests, and
 * rotation with family revocation makes a stolen one usable at most once.
 */
const REFRESH_PATH = "/";

/** Cookies written before the path widened, cleared so they cannot linger. */
const LEGACY_REFRESH_PATH = "/api/auth";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @ZodBody(loginSchema) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, tokens } = await this.auth.login(body, clientOf(request));
    setAuthCookies(response, tokens);
    return this.auth.describe(user);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const presented = readCookie(request, REFRESH_COOKIE);
    if (!presented) {
      clearAuthCookies(response);
      return { signedIn: false };
    }

    try {
      const { user, tokens } = await this.auth.refresh(
        presented,
        clientOf(request),
      );
      setAuthCookies(response, tokens);
      return this.auth.describe(user);
    } catch (error) {
      clearAuthCookies(response);
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(readCookie(request, REFRESH_COOKIE));
    clearAuthCookies(response);
    return { signedOut: true };
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.describe(user);
  }

  @Post("change-password")
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(changePasswordSchema) body: ChangePasswordInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changePassword(user, body);
    // Every session was revoked, including this one.
    clearAuthCookies(response);
    return { changed: true };
  }

  /* ------------------------------------------------------------------------ */
  /*  Two-factor — enrolment only. Sign-in does not ask for a code yet.        */
  /* ------------------------------------------------------------------------ */

  @Get("2fa")
  twoFactorStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.status(user.id);
  }

  /**
   * Returns the secret in the response body, once, and that is the only way it
   * ever leaves the server — there is no endpoint that reads it back. Somebody
   * who closes the page before scanning starts again.
   */
  @Post("2fa/setup")
  @HttpCode(200)
  beginTwoFactorSetup(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(beginTwoFactorSetupSchema) body: BeginTwoFactorSetupInput,
  ) {
    return this.twoFactor.beginSetup(user, body.password);
  }

  @Post("2fa/confirm")
  @HttpCode(200)
  confirmTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(confirmTwoFactorSchema) body: ConfirmTwoFactorInput,
  ) {
    return this.twoFactor.confirmSetup(user, body.code);
  }

  @Post("2fa/disable")
  @HttpCode(200)
  disableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(twoFactorPasswordAndCodeSchema)
    body: TwoFactorPasswordAndCodeInput,
  ) {
    return this.twoFactor.disable(user, body.password, body.code);
  }

  @Post("2fa/recovery-codes")
  @HttpCode(200)
  regenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(twoFactorPasswordAndCodeSchema)
    body: TwoFactorPasswordAndCodeInput,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(
      user,
      body.password,
      body.code,
    );
  }
}

/* -------------------------------------------------------------------------- */

function clientOf(request: Request) {
  return {
    ip: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.[name];
}

/**
 * Both tokens are httpOnly so no script can read them, which is what makes an
 * XSS bug non-fatal here. The refresh cookie is scoped to /api/auth so it is
 * not attached to ordinary API calls.
 *
 * `sameSite: "lax"` works because the web app and API are served from one
 * origin behind nginx in production, and from localhost in development.
 */
/**
 * Where the auth cookies are allowed to travel.
 *
 * Empty means host-only, which is right when the browser sees a single origin.
 * Set to `.example.com` when the web app and the API sit on different
 * subdomains: the cookie is written by api.example.com but app.example.com
 * server-renders the pages and needs it too, and a host-only cookie never
 * reaches it — sign-in succeeds and every page still says signed out.
 */
function cookieDomain(): string | undefined {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return domain ? domain : undefined;
}

function cookieOptions(maxAgeMs: number, path: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    /**
     * Stays `lax` across subdomains, and deliberately.
     *
     * SameSite is judged on the registrable domain, not the origin, so
     * app.example.com calling api.example.com is *same-site* — cross-origin,
     * but same-site — and a Lax cookie is sent. The reflex here is to reach
     * for `none`, which would also send it to genuinely foreign sites and
     * throw away the protection for nothing.
     */
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeMs,
    ...(cookieDomain() ? { domain: cookieDomain() } : {}),
  };
}

function setAuthCookies(response: Response, tokens: IssuedTokens) {
  // The cookie deliberately outlives the JWT inside it. The JWT expires in ~15
  // minutes; the cookie lasts as long as the refresh token so the browser still
  // has a "signed in" marker. Otherwise the cookie vanishes at 15 minutes and
  // the app bounces a perfectly valid session back to the login page. An
  // expired JWT is rejected by the guard, and the client refreshes and retries.
  const carrierMaxAge = tokens.refreshExpiresAt.getTime() - Date.now();
  response.cookie(
    ACCESS_COOKIE,
    tokens.accessToken,
    cookieOptions(carrierMaxAge, "/"),
  );
  response.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(tokens.refreshExpiresAt.getTime() - Date.now(), REFRESH_PATH),
  );
}

/**
 * Clearing has to name the same domain the cookie was written with.
 *
 * A cookie set for `.example.com` and cleared without it is not cleared — the
 * browser treats them as different cookies and quietly keeps the first. Signing
 * out would appear to work and leave the session cookie in place, which is the
 * worst possible way for this to fail.
 */
function clearAuthCookies(response: Response) {
  const domain = cookieDomain();
  const scope = domain ? { domain } : {};
  response.clearCookie(ACCESS_COOKIE, { path: "/", ...scope });
  response.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH, ...scope });
  response.clearCookie(REFRESH_COOKIE, { path: LEGACY_REFRESH_PATH, ...scope });
  // Also clear any host-only cookie left from before a COOKIE_DOMAIN was set,
  // so switching to subdomains does not strand an old cookie that the browser
  // keeps sending alongside the new one.
  if (domain) {
    response.clearCookie(ACCESS_COOKIE, { path: "/" });
    response.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  }
}
