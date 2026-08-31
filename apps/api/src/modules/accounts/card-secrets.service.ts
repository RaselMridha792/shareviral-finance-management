import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import { open, seal } from "../../common/crypto/secret-box";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { accounts } from "../../db/schema";
import { CardPasswordService } from "./card-password.service";

/**
 * Reading a card number back, and writing one in.
 *
 * Kept away from `AccountsService` on purpose. Everything there answers with
 * `AccountDto`, which omits the sealed columns at the type level so that a
 * leak becomes a compile error; this is the one place that touches them, and
 * keeping it separate is what makes that boundary visible rather than a
 * convention somebody has to remember.
 *
 * A reveal costs three things in order, and the order matters:
 *   1. the permission (`accounts.write` — super_admin, admin, cfo);
 *   2. the shared card password;
 *   3. an audit row, whether or not the password was right.
 * Permission first, so somebody without the role never learns whether their
 * guess was correct.
 */
@Injectable()
export class CardSecretsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly password: CardPasswordService,
  ) {}

  /** Stores the number and CVC, sealed, and derives the last four. */
  async store(
    id: string,
    input: { cardNumber?: string | null; cardCvc?: string | null },
    actor: AuthenticatedUser,
  ): Promise<void> {
    const digits = input.cardNumber?.replace(/[^0-9]/g, "") ?? null;
    if (digits !== null && digits.length > 0 && digits.length < 12) {
      throw new BadRequestException(
        "A card number is at least 12 digits — check what was typed",
      );
    }

    await this.db.client
      .update(accounts)
      .set({
        cardNumberSealed: digits ? seal(digits) : null,
        cardLast4: digits ? digits.slice(-4) : null,
        cardCvcSealed: input.cardCvc ? seal(input.cardCvc) : null,
        cardSecretsSetAt: new Date(),
        cardSecretsSetBy: actor.id,
      })
      .where(eq(accounts.id, id));
  }

  /**
   * The number and the CVC, once.
   *
   * Nothing is cached and nothing is returned twice without asking again — the
   * password is typed each time. That is deliberate friction on the one act in
   * this app that hands over a usable payment instrument.
   */
  async reveal(
    id: string,
    cardPassword: string,
    actor: AuthenticatedUser,
  ): Promise<{ cardNumber: string | null; cardCvc: string | null }> {
    const [row] = await this.db.client
      .select({
        name: accounts.name,
        sealedNumber: accounts.cardNumberSealed,
        sealedCvc: accounts.cardCvcSealed,
      })
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("That account is not here");

    /*
     * A wrong password is audited too. `assert` throws, so the row is written
     * first — a failed attempt that left no trace would make the audit log
     * agree with an attacker rather than with the truth.
     */
    try {
      await this.password.assert(cardPassword, actor);
    } catch (error) {
      await this.audit.log({
        action: "update",
        entityTable: "accounts",
        entityId: id,
        module: "accounts",
        summary: `Wrong card password while trying to read ${row.name}`,
        isSensitive: true,
      });
      throw error;
    }

    if (!row.sealedNumber && !row.sealedCvc) {
      throw new BadRequestException("No card details are stored on this one");
    }

    /*
     * `open` returns null when the value cannot be read — which after a key
     * rotation means "unreadable", not "not set". Saying "no card on file"
     * there would be a lie that sends somebody looking for the card instead of
     * for the key.
     */
    const cardNumber = row.sealedNumber ? open(row.sealedNumber) : null;
    const cardCvc = row.sealedCvc ? open(row.sealedCvc) : null;
    if (row.sealedNumber && cardNumber === null) {
      throw new BadRequestException(
        "The stored card cannot be read with the current encryption key",
      );
    }

    await this.audit.log({
      action: "update",
      entityTable: "accounts",
      entityId: id,
      module: "accounts",
      summary: `Read the card details for ${row.name}`,
      isSensitive: true,
    });

    return { cardNumber, cardCvc };
  }
}
