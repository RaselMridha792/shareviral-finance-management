import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission, type Role } from "@finance/shared";
import type { Request } from "express";

import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
  type AuthenticatedUser,
} from "../decorators/auth.decorators";

type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * Enforces `@Roles` and `@RequirePermission`.
 *
 * The permission list lives in `@finance/shared`, so the sidebar hides exactly
 * what this refuses. A 403 here is the real boundary — the UI hiding a menu
 * item is only a convenience on top of it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new ForbiddenException("Not signed in");

    if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
      throw new ForbiddenException("Your role cannot do this");
    }

    if (required?.length) {
      const missing = required.filter((p) => !hasPermission(user.role, p));
      if (missing.length) {
        throw new ForbiddenException(
          `Your role cannot do this (needs ${missing.join(", ")})`,
        );
      }
    }

    return true;
  }
}
