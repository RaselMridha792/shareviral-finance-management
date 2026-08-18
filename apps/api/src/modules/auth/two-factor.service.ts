import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import qrcode from "qrcode-generator";

import { AuditService } from "../../common/audit/audit.service";
import { open, seal } from "../../common/crypto/secret-box";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { recoveryCodes, users, userTwoFactor } from "../../db/schema";
import { generateSecret, otpauthUrl, verify } from "./totp";

/**
 * Enrolling a second factor, and checking one.
 *
 * The login path is not in this file. Enrolment can be deployed and used on its
 * own — people add their authenticator, confirm it works, keep their recovery
 * codes — and only when everybody has done that does the second step at sign-in
 * become worth turning on. Doing it the other way round is how five people get
 * locked out of a finance system at once.
 */

/** Ten, the number everybody's printout has. */
const RECOVERY_CODE_COUNT = 10;

/**
 * Five wrong codes, then five minutes — the same shape as the password lockout,
 * and needed for its own reason.
 *
 * A six-digit code is one in a million, which sounds like plenty until you
 * notice that somebody guessing it has already got past the password and can
 * try as fast as the server answers. Without a counter, a million guesses is an
 * afternoon. With this, it is sixty an hour.
 *
 * It is a *separate* counter from the password one on `users` on purpose:
 * resetting the password counter on a correct password would otherwise hand a
 * fresh five guesses at the code with every sign-in.
 */
const MAX_FAILED_CODES = 5;
const CODE_LOCKOUT_MINUTES = 5;

export type TwoFactorStatus = {
  enrolled: boolean;
  confirmedAt: string | null;
  recoveryCodesLeft: number;
};

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const row = await this.rowFor(userId);
    if (!row?.confirmedAt) {
      return { enrolled: false, confirmedAt: null, recoveryCodesLeft: 0 };
    }

    const [counted] = await this.db.client
      .select({ n: sql<number>`count(*)::int` })
      .from(recoveryCodes)
      .where(
        and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)),
      );

    return {
      enrolled: true,
      confirmedAt: row.confirmedAt.toISOString(),
      recoveryCodesLeft: counted?.n ?? 0,
    };
  }

  /**
   * Issues a secret and returns it once, for the QR and for typing in by hand.
   *
   * Nothing is enrolled yet — `confirmedAt` stays null until a code proves the
   * phone actually has it. An abandoned setup therefore cannot lock anybody
   * out, which is why this replaces any previous *unconfirmed* row rather than
   * refusing, and refuses outright once a confirmed one exists.
   *
   * The password is required even though the caller is already signed in.
   * Re-enrolling silently would let somebody with a stolen session swap the
   * second factor for their own, which is worse than not having one.
   */
  async beginSetup(actor: AuthenticatedUser, password: string) {
    await this.assertPassword(actor.id, password);

    const existing = await this.rowFor(actor.id);
    if (existing?.confirmedAt) {
      throw new BadRequestException(
        "Two-factor is already switched on for this account. Turn it off first if you want to use a different phone.",
      );
    }

    const secret = generateSecret();
    // seal() throws if no key is configured, which is the right moment to find
    // out — before anything is stored and before a QR is on screen.
    const secretEncrypted = seal(secret);

    if (existing) {
      await this.db.client
        .update(userTwoFactor)
        .set({
          secretEncrypted,
          lastStep: null,
          failedCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(userTwoFactor.id, existing.id));
    } else {
      await this.db.client
        .insert(userTwoFactor)
        .values({ userId: actor.id, secretEncrypted });
    }

    await this.audit.log({
      action: "update",
      entityTable: "user_two_factor",
      entityId: actor.id,
      summary: `${actor.fullName} started two-factor setup`,
      module: "auth",
      actorUserId: actor.id,
      actorRole: actor.role,
    });

    const url = otpauthUrl({
      secret,
      account: actor.email,
      issuer: "ShareViral Finance",
    });

    return { secret, otpauthUrl: url, qrSvg: qrSvgFor(url) };
  }

  /**
   * One correct code, and it is on. Returns the recovery codes, once.
   *
   * They are shown here and never again — only their hashes are kept — because
   * a list the server can still read is a list a database dump hands over, and
   * these are password-equivalent.
   */
  async confirmSetup(actor: AuthenticatedUser, code: string) {
    const row = await this.rowFor(actor.id);
    if (!row) {
      throw new BadRequestException(
        "Start the setup first — there is nothing to confirm.",
      );
    }
    if (row.confirmedAt) {
      throw new BadRequestException("Two-factor is already switched on.");
    }

    const result = verify(this.secretOf(row.secretEncrypted), code);
    if (!result.ok) {
      throw new BadRequestException(
        "That code is not right. Check your phone's clock is set automatically, then try the next one.",
      );
    }

    const codes = await this.replaceRecoveryCodes(actor.id);

    await this.db.client
      .update(userTwoFactor)
      .set({
        confirmedAt: new Date(),
        lastStep: result.step,
        failedCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(userTwoFactor.id, row.id));

    await this.audit.log({
      action: "update",
      entityTable: "user_two_factor",
      entityId: actor.id,
      summary: `${actor.fullName} switched two-factor on`,
      module: "auth",
      actorUserId: actor.id,
      actorRole: actor.role,
    });

    return { recoveryCodes: codes };
  }

  /** Password *and* a current code — turning a guard off is not a small act. */
  async disable(actor: AuthenticatedUser, password: string, code: string) {
    await this.assertPassword(actor.id, password);

    const row = await this.rowFor(actor.id);
    if (!row?.confirmedAt) {
      throw new BadRequestException("Two-factor is not switched on.");
    }

    const check = await this.checkCode(actor.id, code);
    if (!check.ok) throw new BadRequestException(check.message);

    await this.db.client
      .delete(userTwoFactor)
      .where(eq(userTwoFactor.userId, actor.id));
    await this.db.client
      .delete(recoveryCodes)
      .where(eq(recoveryCodes.userId, actor.id));

    await this.audit.log({
      action: "update",
      entityTable: "user_two_factor",
      entityId: actor.id,
      summary: `${actor.fullName} switched two-factor OFF`,
      module: "auth",
      actorUserId: actor.id,
      actorRole: actor.role,
    });

    return { disabled: true };
  }

  /** A fresh printout. The old codes stop working the moment this returns. */
  async regenerateRecoveryCodes(
    actor: AuthenticatedUser,
    password: string,
    code: string,
  ) {
    await this.assertPassword(actor.id, password);

    const row = await this.rowFor(actor.id);
    if (!row?.confirmedAt) {
      throw new BadRequestException("Two-factor is not switched on.");
    }

    const check = await this.checkCode(actor.id, code);
    if (!check.ok) throw new BadRequestException(check.message);

    const codes = await this.replaceRecoveryCodes(actor.id);

    await this.audit.log({
      action: "update",
      entityTable: "recovery_codes",
      entityId: actor.id,
      summary: `${actor.fullName} generated new recovery codes`,
      module: "auth",
      actorUserId: actor.id,
      actorRole: actor.role,
    });

    return { recoveryCodes: codes };
  }

  /* ------------------------------------------------------------------------ */
  /*  Checking a code — used by the screens above and, later, by sign-in       */
  /* ------------------------------------------------------------------------ */

  /** True when this account must present a second factor. */
  async isEnrolled(userId: string): Promise<boolean> {
    const row = await this.rowFor(userId);
    return Boolean(row?.confirmedAt);
  }

  /**
   * A code from the phone, or one of the recovery codes.
   *
   * Never throws for a wrong code — it returns why, so the caller decides
   * whether that is a 400 on a settings screen or a 401 at sign-in.
   */
  async checkCode(
    userId: string,
    code: string,
    ip?: string | null,
  ): Promise<
    { ok: true; usedRecoveryCode: boolean } | { ok: false; message: string }
  > {
    const row = await this.rowFor(userId);
    if (!row?.confirmedAt) {
      return { ok: false, message: "Two-factor is not switched on." };
    }

    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (row.lockedUntil.getTime() - Date.now()) / 60_000,
      );
      return {
        ok: false,
        message: `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      };
    }

    const cleaned = code.replace(/\s/g, "");

    // The six-digit path first, because it is the one people use.
    const result = verify(this.secretOf(row.secretEncrypted), cleaned);
    if (result.ok) {
      // The replay check the algorithm cannot do for itself: a code stays
      // mathematically valid for its whole window, so the last accepted step is
      // remembered and anything at or below it is refused.
      if (row.lastStep !== null && result.step <= row.lastStep) {
        await this.registerCodeFailure(row.id, row.failedCount);
        return {
          ok: false,
          message: "That code has already been used. Wait for the next one.",
        };
      }

      await this.db.client
        .update(userTwoFactor)
        .set({
          lastStep: result.step,
          failedCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(userTwoFactor.id, row.id));

      return { ok: true, usedRecoveryCode: false };
    }

    if (await this.spendRecoveryCode(userId, cleaned, ip)) {
      await this.db.client
        .update(userTwoFactor)
        .set({ failedCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(userTwoFactor.id, row.id));
      return { ok: true, usedRecoveryCode: true };
    }

    await this.registerCodeFailure(row.id, row.failedCount);
    return { ok: false, message: "That code is not right." };
  }

  /* ------------------------------------------------------------------------ */

  private async rowFor(userId: string) {
    const [row] = await this.db.client
      .select()
      .from(userTwoFactor)
      .where(eq(userTwoFactor.userId, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Unwraps the stored secret, and refuses to carry on without it.
   *
   * `open()` returns null rather than throwing — right for the assistant's API
   * key, where a rotated server secret should show "no key configured" instead
   * of breaking Settings. Here it must not be treated as a value. A null read
   * as "this account has no second factor" would switch two-factor off for
   * everybody, silently, on the day somebody rotated a secret; and read as "the
   * code is wrong" it would lock everybody out with a message pointing at their
   * phone. So: a 500 that says what actually happened.
   */
  private secretOf(sealed: string): string {
    const secret = open(sealed);
    if (!secret) {
      throw new InternalServerErrorException(
        "The stored two-factor secret cannot be read. SECRET_ENCRYPTION_KEY has most likely changed; enrolments made under the old key have to be redone.",
      );
    }
    return secret;
  }

  private async assertPassword(userId: string, password: string) {
    const [record] = await this.db.client
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!record || !(await bcrypt.compare(password, record.passwordHash))) {
      throw new UnauthorizedException("That password is not right.");
    }
  }

  private async registerCodeFailure(rowId: string, current: number) {
    const next = current + 1;
    const lock =
      next >= MAX_FAILED_CODES
        ? new Date(Date.now() + CODE_LOCKOUT_MINUTES * 60_000)
        : null;

    await this.db.client
      .update(userTwoFactor)
      .set({
        failedCount: lock ? 0 : next,
        lockedUntil: lock,
        updatedAt: new Date(),
      })
      .where(eq(userTwoFactor.id, rowId));
  }

  /**
   * Ten codes, each 80 bits of randomness in Crockford-ish base32.
   *
   * Grouped `xxxx-xxxx-xxxx-xxxx` because these get written on paper and typed
   * back by somebody having a bad day, and the alphabet leaves out the
   * characters that get misread as each other.
   */
  private async replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      formatRecoveryCode(),
    );

    await this.db.client
      .delete(recoveryCodes)
      .where(eq(recoveryCodes.userId, userId));

    await this.db.client.insert(recoveryCodes).values(
      codes.map((code) => ({
        userId,
        codeHash: hashRecoveryCode(code),
      })),
    );

    return codes;
  }

  /** Marks a matching unused code spent. Returns whether one was found. */
  private async spendRecoveryCode(
    userId: string,
    given: string,
    ip?: string | null,
  ): Promise<boolean> {
    const normalised = normaliseRecoveryCode(given);
    if (!normalised) return false;

    const rows = await this.db.client
      .select({ id: recoveryCodes.id, codeHash: recoveryCodes.codeHash })
      .from(recoveryCodes)
      .where(
        and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)),
      );

    const wanted = Buffer.from(hashRecoveryCode(normalised), "hex");
    // Every row is compared, and the loop does not break, so how long this
    // takes does not depend on which code matched or whether one did.
    let match: string | null = null;
    for (const row of rows) {
      const stored = Buffer.from(row.codeHash, "hex");
      if (stored.length === wanted.length && timingSafeEqual(stored, wanted)) {
        match = row.id;
      }
    }
    if (!match) return false;

    // Conditioned on still being unused, so two requests racing the same code
    // cannot both spend it.
    const spent = await this.db.client
      .update(recoveryCodes)
      .set({ usedAt: new Date(), usedIp: ip ?? null })
      .where(and(eq(recoveryCodes.id, match), isNull(recoveryCodes.usedAt)))
      .returning({ id: recoveryCodes.id });

    return spent.length > 0;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The QR, drawn on the server.
 *
 * Server-side so the browser bundle carries nothing extra for a screen almost
 * nobody opens twice, and so the page never has to hold the secret in
 * JavaScript in order to render it.
 *
 * The output is pure geometry — a white rect and one path, no text, no script,
 * no `foreignObject`, and the URL appears nowhere in the markup. That is what
 * makes it safe to put straight into the DOM, and it is asserted in the tests
 * rather than assumed, because "it is only an image" is how markup gets in.
 *
 * The white background is fixed rather than themed. A QR needs light quiet
 * zones to scan; one that follows a dark page is a better-looking screen that
 * phones cannot read.
 *
 * Error correction M — around 15% of the symbol can be obscured and still
 * decode, which covers a fingerprint on a screen without making the pattern
 * denser than a phone camera is happy with.
 */
export function qrSvgFor(url: string): string {
  // 0 means "smallest version this data fits in".
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/**
 * Crockford's base32 without 0 and 1.
 *
 * Crockford already drops I, L, O and U — the first three because they are read
 * as 1 and 0, U because leaving it out keeps accidental words off the printout.
 * Dropping 0 and 1 as well removes the other side of those pairs, so there is
 * no character on the page whose twin is also on it.
 *
 * That leaves exactly 30, which is not a coincidence: 30 divides 240 evenly, so
 * the generator can reject bytes at 240 and up and get a flat distribution
 * without any modulo bias. An alphabet of 29 would need a different bound, and
 * getting it wrong costs entropy silently rather than failing.
 *
 * 8 stays, and B with it. That pair is the one genuine ambiguity here; it is
 * kept because the even division is worth more than the difference between a
 * good handwritten 8 and a good handwritten B, and because a wrong code is a
 * retry rather than a loss — there are ten of them.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function formatRecoveryCode(): string {
  // 16 characters from a 30-character alphabet is a little over 78 bits.
  // randomInt-free rejection sampling would be tidier; 30 divides 240 evenly,
  // so masking bytes below 240 keeps the distribution flat without it.
  const chars: string[] = [];
  while (chars.length < 16) {
    for (const byte of randomBytes(24)) {
      if (chars.length === 16) break;
      if (byte >= 240) continue; // 240 = 30 * 8, so the rest would skew
      chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
    }
  }
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-");
}

/** Hyphens, spaces and case are how people type; none of them are the code. */
export function normaliseRecoveryCode(given: string): string | null {
  const clean = given.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length !== 16) return null;
  if (![...clean].every((c) => CODE_ALPHABET.includes(c))) return null;
  return clean.replace(/(.{4})(?=.)/g, "$1-");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256")
    .update(code.replace(/[\s-]/g, "").toUpperCase(), "utf8")
    .digest("hex");
}
