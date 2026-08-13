import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { Permission, Role } from "@finance/shared";
import type { Request } from "express";

export const IS_PUBLIC_KEY = "auth:public";
export const ROLES_KEY = "auth:roles";
export const PERMISSIONS_KEY = "auth:permissions";

/** Skips authentication entirely — login, refresh, health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts to specific roles. Prefer `@RequirePermission` — roles are coarse
 * and tend to drift; permissions say what the endpoint actually needs.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The endpoint requires every listed permission. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  tokenVersion: number;
  mustChangePassword: boolean;
};

type RequestWithUser = Request & { user?: AuthenticatedUser };

/** `@CurrentUser() user: AuthenticatedUser` */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    return field && user ? user[field] : user;
  },
);
