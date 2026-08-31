import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { appSettings } from "../../db/schema";

/**
 * The password that stands between a signed-in admin and a card number.
 *
 * The owner chose a shared password that a few people know, on top of the
 * role — so revealing a card needs BOTH `accounts.write` (super_admin, admin,
 * cfo) and this typed in. He was told what a shared secret costs and chose it
 * anyway; the cost is written down in `2026-08-31-card-password.sql` and in
 * SESSIONS.md so it stays his decision rather than becoming a surprise.
 *
 * Null until somebody sets one, and while it is null every reveal is refused.
 * That is the safe direction to fail: a card number behind no password at all
 * is worse than one nobody can reach yet.
 */
@Injectable()
export class CardPasswordService {
  /*
   * bcrypt's own cost is the real brake — a comparison takes ~100ms, so a
   * network attacker gets ten guesses a second rather than thousands. This
   * counter is the second one, and it is honest about what it is: held in
   * memory, so it resets when the API restarts.
   *
   * It is not a substitute for a rate limiter, and this app has none anywhere
   * (no @nestjs/throttler, no @Throttle). What it does buy is that somebody
   * guessing through the UI stops after five, and that every attempt — right
   * or wrong — is in the audit log, which is where a pattern would be seen.
   */
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly COOL_OFF_MS = 5 * 60 * 1000;
  private readonly attempts = new Map<
    string,
    { count: number; firstAt: number }
  >();

  /** How many bcrypt rounds. The same figure the seeder uses for sign-ins. */
  private static readonly ROUNDS = 12;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Whether one is set, and when it was last changed. Never the hash. */
  async status(): Promise<{ isSet: boolean; setAt: Date | null }> {
    const [row] = await this.db.client
      .select({
        hash: appSettings.cardPasswordHash,
        setAt: appSettings.cardPasswordSetAt,
      })
      .from(appSettings)
      .limit(1);

    return { isSet: Boolean(row?.hash), setAt: row?.setAt ?? null };
  }

  /**
   * Set it, or change it.
   *
   * Changing needs the current one. Not because an admin could not simply read
   * the row — they could — but because the person changing a shared password
   * has to be somebody who already knew it, or "shared" means nothing.
   */
  async set(
    input: { current?: string | null; next: string },
    actor: AuthenticatedUser,
  ): Promise<{ isSet: true }> {
    const [row] = await this.db.client
      .select({ hash: appSettings.cardPasswordHash })
      .from(appSettings)
      .limit(1);

    if (row?.hash) {
      if (!input.current) {
        throw new BadRequestException(
          "Type the current card password before setting a new one",
        );
      }
      const ok = await bcrypt.compare(input.current, row.hash);
      if (!ok) {
        throw new ForbiddenException("That is not the current card password");
      }
    }

    const hash = await bcrypt.hash(input.next, CardPasswordService.ROUNDS);

    await this.audit.mutate({
      action: "update",
      entityTable: "app_settings",
      entityId: null,
      module: "settings",
      /*
       * The summary says what changed and not what it changed to. It is the
       * one audit line in this app whose value must never appear in it.
       */
      summary: row?.hash
        ? "Changed the card password"
        : "Set the card password for the first time",
      isSensitive: true,
      read: () => Promise.resolve({ cardPasswordSet: Boolean(row?.hash) }),
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            cardPasswordHash: hash,
            cardPasswordSetAt: sql`now()`,
            cardPasswordSetBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
        return { isSet: true as const };
      },
    });

    // A new password clears everybody's cool-off: the old one is gone, so
    // somebody who mistyped the old one is not being punished for the new.
    this.attempts.clear();
    return { isSet: true };
  }

  /**
   * Throws unless this is the card password.
   *
   * Called by the reveal, after the permission check — order matters, so that
   * somebody without the role never learns whether their guess was right.
   */
  async assert(password: string, actor: AuthenticatedUser): Promise<void> {
    const now = Date.now();
    const record = this.attempts.get(actor.id);
    if (record && now - record.firstAt > CardPasswordService.COOL_OFF_MS) {
      this.attempts.delete(actor.id);
    }
    const live = this.attempts.get(actor.id);
    if (live && live.count >= CardPasswordService.MAX_ATTEMPTS) {
      const minutes = Math.ceil(
        (CardPasswordService.COOL_OFF_MS - (now - live.firstAt)) / 60000,
      );
      throw new ForbiddenException(
        `Too many wrong card passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      );
    }

    const [row] = await this.db.client
      .select({ hash: appSettings.cardPasswordHash })
      .from(appSettings)
      .limit(1);

    if (!row?.hash) {
      throw new BadRequestException(
        "No card password has been set. Somebody with settings access has to set one before a card can be read.",
      );
    }

    const ok = await bcrypt.compare(password, row.hash);
    if (!ok) {
      const existing = this.attempts.get(actor.id);
      this.attempts.set(actor.id, {
        count: (existing?.count ?? 0) + 1,
        firstAt: existing?.firstAt ?? now,
      });
      throw new ForbiddenException("That is not the card password");
    }

    this.attempts.delete(actor.id);
  }
}
