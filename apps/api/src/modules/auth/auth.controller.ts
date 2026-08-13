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
  changePasswordSchema,
  loginSchema,
  type ChangePasswordInput,
  type LoginInput,
} from "./auth.schemas";
import type { IssuedTokens } from "./token.service";

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
  constructor(private readonly auth: AuthService) {}

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
function cookieOptions(maxAgeMs: number, path: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path,
    maxAge: maxAgeMs,
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

function clearAuthCookies(response: Response) {
  response.clearCookie(ACCESS_COOKIE, { path: "/" });
  response.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
  response.clearCookie(REFRESH_COOKIE, { path: LEGACY_REFRESH_PATH });
}
