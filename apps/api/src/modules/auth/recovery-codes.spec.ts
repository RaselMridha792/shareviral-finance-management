/**
 * The parts of recovery codes that are pure, and therefore testable without a
 * database: how one is made, and how one typed back is recognised.
 *
 * Worth its own file because both halves have a quiet failure mode. The
 * generator uses rejection sampling, where an off-by-one does not crash — it
 * just makes some characters likelier than others and silently costs entropy.
 * And the normaliser decides what counts as "the same code", which is the
 * difference between somebody getting back into the finance system with the
 * paper in their hand and not.
 */
import {
  formatRecoveryCode,
  hashRecoveryCode,
  normaliseRecoveryCode,
} from "./two-factor.service";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("formatRecoveryCode", () => {
  it("is four groups of four, hyphenated", () => {
    for (let i = 0; i < 100; i++) {
      expect(formatRecoveryCode()).toMatch(
        /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/,
      );
    }
  });

  it("never uses a character whose lookalike is also on the page", () => {
    // These get written down by hand and typed back by somebody who has just
    // lost their phone. Both halves of each confusable pair are gone: no 0 and
    // no O, no 1 and no I or L. U is out because it keeps accidental words off
    // a printed page.
    //
    // 8 and B both stay, which is the one real ambiguity left. That is a
    // deliberate trade for an alphabet of exactly 30 — see CODE_ALPHABET.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const c of formatRecoveryCode().replace(/-/g, "")) seen.add(c);
    }
    for (const c of seen) expect(ALPHABET).toContain(c);
    for (const forbidden of ["0", "1", "O", "I", "L", "U"]) {
      expect(seen.has(forbidden)).toBe(false);
    }
  });

  it("uses the whole alphabet, roughly evenly", () => {
    // The rejection sampling exists so that 256 does not divide unevenly into
    // 30 and skew the first six characters. If the `>= 240` bound were wrong,
    // this is what would show it: not a crash, just a lopsided distribution.
    const counts = new Map<string, number>();
    const draws = 20_000;
    for (let i = 0; i < draws / 16; i++) {
      for (const c of formatRecoveryCode().replace(/-/g, "")) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(ALPHABET.length);

    const expected = draws / ALPHABET.length;
    // Reported per character, so a failure says *which* one was over-drawn
    // rather than only that something was.
    const skewed = [...counts.entries()].filter(
      ([, n]) => n < expected * 0.7 || n > expected * 1.3,
    );
    // Generous bounds, because this is random: a genuine bias like "the first
    // six characters appear 27% more often" clears this bar by a mile.
    expect(skewed.map(([char, n]) => `${char}:${n}`)).toEqual([]);
  });

  it("does not repeat itself", () => {
    const made = new Set(Array.from({ length: 2000 }, formatRecoveryCode));
    expect(made.size).toBe(2000);
  });
});

describe("normaliseRecoveryCode", () => {
  it("accepts the code exactly as it was printed", () => {
    const code = formatRecoveryCode();
    expect(normaliseRecoveryCode(code)).toBe(code);
  });

  it("accepts it typed without hyphens, with spaces, or in lower case", () => {
    const code = formatRecoveryCode();
    const bare = code.replace(/-/g, "");
    for (const typed of [
      bare,
      bare.toLowerCase(),
      code.toLowerCase(),
      code.replace(/-/g, " "),
      `  ${code}  `,
      bare.replace(/(.{4})/g, "$1 "),
    ]) {
      expect(normaliseRecoveryCode(typed)).toBe(code);
    }
  });

  it("refuses the wrong length", () => {
    expect(normaliseRecoveryCode("")).toBeNull();
    expect(normaliseRecoveryCode("ABCD-EFGH")).toBeNull();
    expect(normaliseRecoveryCode("23456789ABCDEFGHJ")).toBeNull();
  });

  it("refuses characters outside the alphabet", () => {
    // A six-digit authenticator code must not be mistaken for a recovery code,
    // and neither must anything with an O or an l in it.
    expect(normaliseRecoveryCode("123456")).toBeNull();
    expect(normaliseRecoveryCode("2345678900000000")).toBeNull();
    expect(normaliseRecoveryCode("ABCDEFGHJKMNPQRO")).toBeNull();
  });
});

describe("hashRecoveryCode", () => {
  it("gives the same hash however the code was typed", () => {
    const code = formatRecoveryCode();
    const bare = code.replace(/-/g, "");
    const expected = hashRecoveryCode(code);
    for (const typed of [bare, bare.toLowerCase(), code.toLowerCase()]) {
      expect(hashRecoveryCode(typed)).toBe(expected);
    }
  });

  it("gives different hashes for different codes", () => {
    const a = formatRecoveryCode();
    const b = formatRecoveryCode();
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
  });

  it("is a sha256 hex digest", () => {
    expect(hashRecoveryCode(formatRecoveryCode())).toMatch(/^[0-9a-f]{64}$/);
  });
});
