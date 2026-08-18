import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";

/**
 * The ticket between "your password was right" and "here is your session".
 *
 * A two-step sign-in needs somewhere to keep "this person passed the password
 * a moment ago" while they reach for their phone. That thing is, by
 * construction, a credential — and the dangerous version of it is one that
 * accidentally works as a *session*.
 *
 * The guard on every other route verifies a JWT against JWT_ACCESS_SECRET,
 * looks the user up by `sub`, checks `tv`, and lets them in. It does not ask
 * what the token was minted for. So a challenge signed with that secret,
 * carrying those claims, would be a complete authentication bypass: pass the
 * password, get the challenge, send it as your access token, skip the code
 * entirely.
 *
 * Two independent things stop that here, because one would be a comment
 * somebody could later undo without noticing:
 *
 *  1. **A different signing key.** Derived from the access secret rather than
 *     configured separately — no new environment variable to forget — but
 *     domain-separated, so a challenge simply does not verify as an access
 *     token. This holds even if the guard changes.
 *  2. **A `typ` claim**, required here and refused by the guard. Cheap, and it
 *     turns a silent acceptance into a 401.
 *
 * What this deliberately does not do is track challenges in the database to
 * make them single-use. A challenge on its own is worthless — it still needs
 * the code, and wrong codes are counted and locked out per account — so the
 * table, its writes and its cleanup would buy very little. Five minutes is
 * short enough to reach for a phone and not much else.
 */

export const CHALLENGE_TYPE = "2fa";
const CHALLENGE_TTL = "5m";

export type ChallengeClaims = {
  sub: string;
  typ: typeof CHALLENGE_TYPE;
};

@Injectable()
export class ChallengeService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * Domain separation, so this key and the access key cannot be the same
   * value even though one is derived from the other.
   */
  private secret(): string {
    const base = process.env.JWT_ACCESS_SECRET;
    if (!base) throw new Error("JWT_ACCESS_SECRET is not set");
    return createHash("sha256")
      .update(`sfm:2fa-challenge:${base}`, "utf8")
      .digest("hex");
  }

  async issue(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: CHALLENGE_TYPE } satisfies ChallengeClaims,
      { secret: this.secret(), expiresIn: CHALLENGE_TTL },
    );
  }

  /** The user id, or a 401. Never returns a session of any kind. */
  async open(challenge: string): Promise<string> {
    let claims: ChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<ChallengeClaims>(challenge, {
        secret: this.secret(),
      });
    } catch {
      throw new UnauthorizedException(
        "That took too long. Enter your password again.",
      );
    }

    // Belt and braces: the signature already proves this was minted as a
    // challenge, because nothing else is signed with this key.
    if (claims.typ !== CHALLENGE_TYPE || !claims.sub) {
      throw new UnauthorizedException("Enter your password again.");
    }

    return claims.sub;
  }
}
