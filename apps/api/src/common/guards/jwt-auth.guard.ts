import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { eq } from "drizzle-orm";
import type { Request } from "express";

import { DbService } from "../../db/db.service";
import { users } from "../../db/schema";
import {
  IS_PUBLIC_KEY,
  type AuthenticatedUser,
} from "../decorators/auth.decorators";
import { getRequestContext } from "../context/request-context";

export const ACCESS_COOKIE = "sfm_access";

export type AccessTokenClaims = {
  sub: string;
  role: AuthenticatedUser["role"];
  tv: number;
};

type RequestWithUser = Request & { user?: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException("Not signed in");

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException("Session expired");
    }

    const [record] = await this.db.client
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        status: users.status,
        tokenVersion: users.tokenVersion,
        mustChangePassword: users.mustChangePassword,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);

    if (!record || record.deletedAt || record.status !== "active") {
      throw new UnauthorizedException("Account is not active");
    }

    // A role change or password reset bumps tokenVersion, killing tokens that
    // were issued under the old permissions without waiting for them to expire.
    if (record.tokenVersion !== claims.tv) {
      throw new UnauthorizedException("Session is no longer valid");
    }

    const user: AuthenticatedUser = {
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      role: record.role,
      tokenVersion: record.tokenVersion,
      mustChangePassword: record.mustChangePassword,
    };

    request.user = user;

    // The request context was opened before authentication ran, so fill in the
    // actor now — the audit trail reads it from there.
    const ctx = getRequestContext();
    if (ctx) {
      ctx.userId = user.id;
      ctx.role = user.role;
    }

    return true;
  }
}

function extractToken(request: Request): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;

  // Bearer is supported so curl and the test suite can authenticate too.
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  return undefined;
}
