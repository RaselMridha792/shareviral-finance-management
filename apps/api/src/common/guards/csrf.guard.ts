import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "finance-web";

/**
 * Cookie authentication reintroduces CSRF: a browser attaches cookies to a
 * cross-site form post automatically. A custom header cannot be set by a plain
 * HTML form, and any cross-origin fetch that tries triggers a preflight our
 * CORS config refuses — so requiring one blocks the attack.
 *
 * Requests authenticated with a Bearer token are exempt: no cookie is involved,
 * so there is nothing for a third-party site to ride on. That is also what lets
 * curl and the test suite work without the header.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) return true;
    if (request.headers.authorization?.startsWith("Bearer ")) return true;

    if (request.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new ForbiddenException(
        "Missing request header. Refresh the page and try again.",
      );
    }

    return true;
  }
}
