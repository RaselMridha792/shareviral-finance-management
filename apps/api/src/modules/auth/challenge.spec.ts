/**
 * The one assertion this file exists for: a sign-in challenge must not work as
 * a session.
 *
 * The guard on every other route verifies a JWT against JWT_ACCESS_SECRET,
 * reads `sub`, checks `tv`, and lets the request through. Until two-step
 * sign-in there was only one kind of JWT here, so "valid" and "is a session"
 * were the same question. They are not any more, and the gap between them is a
 * complete authentication bypass: pass the password, take the challenge, send
 * it as the access token, never touch the phone.
 *
 * Two separate things close it, and both are checked here, because the point of
 * having two is that neither is trusted alone.
 */
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";

import { ChallengeService, CHALLENGE_TYPE } from "./challenge.service";

const ACCESS_SECRET = "test-access-secret-value-long-enough";

describe("ChallengeService", () => {
  const jwt = new JwtService({});
  const challenges = new ChallengeService(jwt);
  const userId = "11111111-2222-3333-4444-555555555555";

  const saved = process.env.JWT_ACCESS_SECRET;
  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  });
  afterAll(() => {
    process.env.JWT_ACCESS_SECRET = saved;
  });

  it("round-trips the user id", async () => {
    const token = await challenges.issue(userId);
    await expect(challenges.open(token)).resolves.toBe(userId);
  });

  /* --------------------------------------------------------------------- */
  /*  Lock one: it is not signed with the access key.                        */
  /* --------------------------------------------------------------------- */

  it("does NOT verify against JWT_ACCESS_SECRET", async () => {
    // This is the bypass, written out. If this ever resolves, a challenge is
    // an access token and the second factor is decorative.
    const token = await challenges.issue(userId);
    await expect(
      jwt.verifyAsync(token, { secret: ACCESS_SECRET }),
    ).rejects.toThrow();
  });

  it("is signed with a key that is not the access secret", async () => {
    const token = await challenges.issue(userId);
    // Decoding needs no key; verifying is what must fail. Proven above, so
    // here we only confirm the payload is what the guard would have trusted -
    // which is exactly why the signature has to be the thing that stops it.
    const claims: { sub?: string; typ?: string } = jwt.decode(token);
    expect(claims.sub).toBe(userId);
    expect(claims.typ).toBe(CHALLENGE_TYPE);
  });

  /* --------------------------------------------------------------------- */
  /*  Lock two: it says what it is, and the guard refuses that.              */
  /* --------------------------------------------------------------------- */

  it("carries a typ claim the guard rejects", async () => {
    const claims: { typ?: string } = jwt.decode(await challenges.issue(userId));
    // jwt-auth.guard.ts refuses any token with a `typ`. Access tokens have
    // none, so this claim's mere presence is the refusal.
    expect(claims.typ).toBeDefined();
  });

  it("refuses an access-shaped token minted with the access secret", async () => {
    // The mirror image: something signed as a session must not open as a
    // challenge either, or the two token types are interchangeable in the
    // other direction.
    const accessLike = await jwt.signAsync(
      { sub: userId, role: "super_admin", tv: 0 },
      { secret: ACCESS_SECRET, expiresIn: "15m" },
    );
    await expect(challenges.open(accessLike)).rejects.toThrow();
  });

  /* --------------------------------------------------------------------- */

  it("expires, and says so in words a person can act on", async () => {
    const expired = await jwt.signAsync(
      { sub: userId, typ: CHALLENGE_TYPE },
      { secret: secretFor(ACCESS_SECRET), expiresIn: "-1s" },
    );
    await expect(challenges.open(expired)).rejects.toThrow(/password again/i);
  });

  it("refuses a challenge signed with a different access secret", async () => {
    // Rotating JWT_ACCESS_SECRET invalidates challenges in flight, which is
    // correct: they are five minutes long and a rotation is not routine.
    const token = await challenges.issue(userId);
    process.env.JWT_ACCESS_SECRET = "a-completely-different-access-secret";
    await expect(challenges.open(token)).rejects.toThrow();
  });

  it("refuses junk rather than throwing something unhandled", async () => {
    for (const junk of ["", "not.a.jwt", "a.b.c"]) {
      await expect(challenges.open(junk)).rejects.toThrow();
    }
  });

  it("refuses a correctly-signed token whose typ is wrong", async () => {
    const wrongType = await jwt.signAsync(
      { sub: userId, typ: "something-else" },
      { secret: secretFor(ACCESS_SECRET), expiresIn: "5m" },
    );
    await expect(challenges.open(wrongType)).rejects.toThrow();
  });

  it("refuses a correctly-signed token with no subject", async () => {
    const noSub = await jwt.signAsync(
      { typ: CHALLENGE_TYPE },
      { secret: secretFor(ACCESS_SECRET), expiresIn: "5m" },
    );
    await expect(challenges.open(noSub)).rejects.toThrow();
  });
});

/** The same derivation the service uses, so the tests can forge deliberately. */
function secretFor(base: string): string {
  return createHash("sha256")
    .update(`sfm:2fa-challenge:${base}`, "utf8")
    .digest("hex");
}
