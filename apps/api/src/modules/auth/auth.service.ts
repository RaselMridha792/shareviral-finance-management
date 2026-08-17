import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { permissionsFor } from "@finance/shared";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { users } from "../../db/schema";
import type { ChangePasswordInput, LoginInput } from "./auth.schemas";
import {
  TokenService,
  type ClientInfo,
  type IssuedTokens,
} from "./token.service";

/**
 * Five wrong passwords, then five minutes of nothing.
 *
 * The wait was fifteen minutes and is five on the owner's instruction. Five is
 * short enough that somebody who genuinely forgot their password is not locked
 * out of their afternoon, and long enough to make guessing pointless: at five
 * tries per five minutes an attacker manages sixty an hour, against a bcrypt
 * hash at cost 12. Guessing a real password at that rate takes longer than the
 * company will exist.
 *
 * The counter is per account, and that is the limit of what it can do. It does
 * nothing against one password tried across every account in turn — no single
 * account ever reaches five — which is why the login route is *also* rate
 * limited per IP address. The two guard different attacks and neither replaces
 * the other.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 5;
export const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async login(
    input: LoginInput,
    client: ClientInfo,
  ): Promise<{ user: AuthenticatedUser; tokens: IssuedTokens }> {
    const [record] = await this.db.client
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    // One message for every failure. Distinguishing "no such account" from
    // "wrong password" tells an attacker which emails are registered.
    const invalid = new UnauthorizedException("Email or password is incorrect");

    if (!record || record.deletedAt) {
      await this.audit.log({
        action: "login_failed",
        entityTable: "users",
        summary: `Failed sign-in for ${input.email} (no such account)`,
        module: "auth",
      });
      throw invalid;
    }

    if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (record.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      throw new UnauthorizedException(
        `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    if (record.status !== "active") {
      await this.audit.log({
        action: "login_failed",
        entityTable: "users",
        entityId: record.id,
        summary: `Failed sign-in for ${record.email} (account ${record.status})`,
        module: "auth",
        actorUserId: record.id,
        actorRole: record.role,
      });
      throw new UnauthorizedException("This account is not active");
    }

    const matches = await bcrypt.compare(input.password, record.passwordHash);
    if (!matches) {
      await this.registerFailure(record.id, record.failedLoginCount);
      await this.audit.log({
        action: "login_failed",
        entityTable: "users",
        entityId: record.id,
        summary: `Failed sign-in for ${record.email} (wrong password)`,
        module: "auth",
        actorUserId: record.id,
        actorRole: record.role,
      });
      throw invalid;
    }

    await this.db.client
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, record.id));

    const issued = await this.tokens.issue(record, client);

    await this.audit.log({
      action: "login",
      entityTable: "users",
      entityId: record.id,
      summary: `${record.fullName} signed in`,
      module: "auth",
      actorUserId: record.id,
      actorRole: record.role,
    });

    return { user: toAuthUser(record), tokens: issued };
  }

  private async registerFailure(userId: string, current: number) {
    const next = current + 1;
    const lock =
      next >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
        : null;

    await this.db.client
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : next,
        lockedUntil: lock,
      })
      .where(eq(users.id, userId));
  }

  async refresh(presented: string, client: ClientInfo) {
    const result = await this.tokens.rotate(presented, client);

    if (!result.ok) {
      if (result.reason === "reused") {
        await this.audit.log({
          action: "logout",
          entityTable: "refresh_tokens",
          summary:
            "Refresh token reuse detected — every session in that family was revoked",
          module: "auth",
        });
      }
      throw new UnauthorizedException("Please sign in again");
    }

    const [record] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.id, result.userId))
      .limit(1);

    if (!record) throw new UnauthorizedException("Please sign in again");

    return { user: toAuthUser(record), tokens: result.tokens };
  }

  async logout(presented: string | undefined, user?: AuthenticatedUser) {
    if (presented) await this.tokens.revoke(presented, "signed out");

    if (user) {
      await this.audit.log({
        action: "logout",
        entityTable: "users",
        entityId: user.id,
        summary: `${user.fullName} signed out`,
        module: "auth",
      });
    }
  }

  async changePassword(user: AuthenticatedUser, input: ChangePasswordInput) {
    const [record] = await this.db.client
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!record) throw new UnauthorizedException("Please sign in again");

    const matches = await bcrypt.compare(
      input.currentPassword,
      record.passwordHash,
    );
    if (!matches) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { currentPassword: ["That is not your current password"] },
      });
    }

    const hash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    await this.audit.mutate({
      action: "update",
      entityTable: "users",
      entityId: user.id,
      summary: `${record.fullName} changed their password`,
      module: "auth",
      read: async (tx) => {
        const [row] = await tx
          .select({
            passwordChangedAt: users.passwordChangedAt,
            tokenVersion: users.tokenVersion,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: hash,
            passwordChangedAt: new Date(),
            mustChangePassword: false,
            // Invalidates every access token issued under the old password.
            tokenVersion: sql`${users.tokenVersion} + 1`,
            updatedAt: new Date(),
            updatedBy: user.id,
          })
          .where(eq(users.id, user.id));
      },
    });

    // Every other device must sign in again.
    await this.tokens.revokeAllForUser(user.id, "password changed");
  }

  /** What `/auth/me` returns — identity plus what this role may do. */
  describe(user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      permissions: permissionsFor(user.role),
    };
  }
}

function toAuthUser(record: {
  id: string;
  email: string;
  fullName: string;
  role: AuthenticatedUser["role"];
  tokenVersion: number;
  mustChangePassword: boolean;
}): AuthenticatedUser {
  return {
    id: record.id,
    email: record.email,
    fullName: record.fullName,
    role: record.role,
    tokenVersion: record.tokenVersion,
    mustChangePassword: record.mustChangePassword,
  };
}
