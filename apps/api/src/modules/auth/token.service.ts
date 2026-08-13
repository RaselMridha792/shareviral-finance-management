import { createHash, randomBytes, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { refreshTokens, users, type User } from "../../db/schema";
import type { AccessTokenClaims } from "../../common/guards/jwt-auth.guard";

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
};

/** Where a refresh token came from, for the audit trail. */
export type ClientInfo = { ip?: string | null; userAgent?: string | null };

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  /**
   * Refresh tokens are opaque random bytes, not JWTs, and only their SHA-256 is
   * stored. A stolen database dump therefore yields no usable sessions, and a
   * token can be revoked instantly — neither is true of a self-contained JWT.
   */
  private static newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString("base64url");
    return { token, hash: TokenService.hash(token) };
  }

  static hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private async signAccessToken(
    user: Pick<User, "id" | "role" | "tokenVersion">,
  ) {
    const claims: AccessTokenClaims = {
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
    };
    return this.jwt.signAsync(claims, {
      secret: process.env.JWT_ACCESS_SECRET,
      // jsonwebtoken types this as a template-literal union, not plain string.
      expiresIn: (process.env.JWT_ACCESS_TTL ??
        "15m") as JwtSignOptions["expiresIn"],
    });
  }

  private static refreshLifetimeMs(): number {
    const ttl = process.env.JWT_REFRESH_TTL ?? "7d";
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 7 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
      match[2] as "s" | "m" | "h" | "d"
    ];
    return value * unit;
  }

  /** Issues a fresh pair and starts a new rotation family. */
  async issue(
    user: Pick<User, "id" | "role" | "tokenVersion">,
    client: ClientInfo,
    tx?: DbTransaction,
  ): Promise<IssuedTokens> {
    return this.persist(user, client, randomUUID(), undefined, tx);
  }

  /**
   * Exchanges a refresh token for a new pair.
   *
   * If the presented token was already rotated, that means two parties hold it
   * — the legitimate user and a thief. There is no way to tell which is which,
   * so the entire family is revoked and both must sign in again.
   */
  async rotate(
    presented: string,
    client: ClientInfo,
  ): Promise<
    | { ok: true; userId: string; tokens: IssuedTokens }
    | { ok: false; reason: "invalid" | "expired" | "reused" }
  > {
    const hash = TokenService.hash(presented);

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .limit(1);

      if (!existing) return { ok: false as const, reason: "invalid" as const };

      if (existing.revokedAt || existing.replacedById) {
        await tx
          .update(refreshTokens)
          .set({
            revokedAt: new Date(),
            revokedReason: "reuse detected — family revoked",
          })
          .where(
            and(
              eq(refreshTokens.familyId, existing.familyId),
              isNull(refreshTokens.revokedAt),
            ),
          );
        return { ok: false as const, reason: "reused" as const };
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        return { ok: false as const, reason: "expired" as const };
      }

      const [user] = await tx
        .select({
          id: users.id,
          role: users.role,
          tokenVersion: users.tokenVersion,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, existing.userId))
        .limit(1);

      if (!user || user.status !== "active") {
        return { ok: false as const, reason: "invalid" as const };
      }

      const tokens = await this.persist(
        user,
        client,
        existing.familyId,
        existing.id,
        tx,
      );

      return { ok: true as const, userId: user.id, tokens };
    });
  }

  private async persist(
    user: Pick<User, "id" | "role" | "tokenVersion">,
    client: ClientInfo,
    familyId: string,
    replacesId: string | undefined,
    tx?: DbTransaction,
  ): Promise<IssuedTokens> {
    const writer = tx ?? this.db.client;
    const { token, hash } = TokenService.newRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + TokenService.refreshLifetimeMs(),
    );

    const [inserted] = await writer
      .insert(refreshTokens)
      .values({
        userId: user.id,
        tokenHash: hash,
        familyId,
        userAgent: client.userAgent ?? null,
        ip: client.ip ?? null,
        expiresAt: refreshExpiresAt,
      })
      .returning({ id: refreshTokens.id });

    if (replacesId) {
      await writer
        .update(refreshTokens)
        .set({ replacedById: inserted.id, revokedAt: new Date() })
        .where(eq(refreshTokens.id, replacesId));
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: token,
      refreshExpiresAt,
    };
  }

  /** Revokes one token (sign-out on this device). */
  async revoke(presented: string, reason: string): Promise<void> {
    await this.db.client
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(refreshTokens.tokenHash, TokenService.hash(presented)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  /** Revokes every session for a user (disable, password reset, role change). */
  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.db.client
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }

  /** Housekeeping: drop rows that can no longer be used. */
  async purgeExpired(): Promise<void> {
    await this.db.client
      .delete(refreshTokens)
      .where(
        or(
          lt(refreshTokens.expiresAt, new Date()),
          lt(refreshTokens.revokedAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      );
  }
}
