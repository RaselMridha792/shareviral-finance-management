/**
 * The RFC's own numbers.
 *
 * RFC 6238 Appendix B prints the expected code for six specific moments, for
 * each of three hash functions. That is the whole reason this was written out
 * instead of installed: these assertions check the implementation against the
 * standard, not against itself. A test that only proves `generate` agrees with
 * `verify` would pass just as happily on a function that returned the wrong
 * digits consistently.
 */
import {
  base32Decode,
  base32Encode,
  generate,
  generateSecret,
  otpauthUrl,
  verify,
} from "./totp";

/**
 * Appendix B uses the ASCII seed "12345678901234567890", repeated to fill each
 * algorithm's key length, and asks for 8 digits.
 */
const seedFor = (algorithm: "sha1" | "sha256" | "sha512") => {
  const bytes = { sha1: 20, sha256: 32, sha512: 64 }[algorithm];
  const ascii = "12345678901234567890".repeat(4).slice(0, bytes);
  return base32Encode(Buffer.from(ascii, "ascii"));
};

describe("TOTP, against RFC 6238 Appendix B", () => {
  const moments = [
    59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000,
  ];

  const expected = {
    sha1: [
      "94287082",
      "07081804",
      "14050471",
      "89005924",
      "69279037",
      "65353130",
    ],
    sha256: [
      "46119246",
      "68084774",
      "67062674",
      "91819424",
      "90698825",
      "77737706",
    ],
    sha512: [
      "90693936",
      "25091201",
      "99943326",
      "93441116",
      "38618901",
      "47863826",
    ],
  } as const;

  for (const algorithm of ["sha1", "sha256", "sha512"] as const) {
    it(`matches every published ${algorithm} vector`, () => {
      const secret = seedFor(algorithm);
      const got = moments.map((now) =>
        generate(secret, { now, digits: 8, algorithm }),
      );
      expect(got).toEqual([...expected[algorithm]]);
    });
  }
});

describe("base32", () => {
  // RFC 4648 §10. Padding is stripped, because otpauth URIs carry none.
  it.each([
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ])("encodes %p as %p", (input, encoded) => {
    expect(base32Encode(Buffer.from(input, "ascii"))).toBe(encoded);
  });

  it("round-trips random bytes", () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateSecret();
      expect(base32Encode(base32Decode(secret))).toBe(secret);
    }
  });

  it("accepts a key typed back with the spaces phones display", () => {
    const secret = generateSecret();
    const spaced = secret.replace(/(.{4})/g, "$1 ").trim();
    expect(base32Decode(spaced)).toEqual(base32Decode(secret));
  });

  it("refuses characters that are not base32", () => {
    // 0/1/8/9 are excluded from the alphabet precisely because they are
    // misread as O/I/B/g, so they must fail loudly rather than decode to junk.
    expect(() => base32Decode("ABC0")).toThrow();
  });

  it("generates a 20-byte secret", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });
});

describe("verify", () => {
  const secret = generateSecret();
  const now = 1_700_000_000;

  it("accepts the code for right now, and says which step it was", () => {
    const result = verify(secret, generate(secret, { now }), { now });
    expect(result).toEqual({ ok: true, step: Math.floor(now / 30) });
  });

  it("tolerates a phone one step behind or ahead", () => {
    for (const drift of [-30, 30]) {
      const code = generate(secret, { now: now + drift });
      expect(verify(secret, code, { now })).toEqual({
        ok: true,
        step: Math.floor((now + drift) / 30),
      });
    }
  });

  it("refuses a code two steps out", () => {
    for (const drift of [-60, 60]) {
      expect(
        verify(secret, generate(secret, { now: now + drift }), { now }),
      ).toEqual({ ok: false });
    }
  });

  it("honours a window of zero", () => {
    const code = generate(secret, { now: now - 30 });
    expect(verify(secret, code, { now, window: 0 })).toEqual({ ok: false });
  });

  it("returns the step, so a caller can refuse a replay", () => {
    // The whole point of the return type: the same code verifies again here,
    // and only the caller comparing steps can stop it.
    const code = generate(secret, { now });
    const first = verify(secret, code, { now });
    const second = verify(secret, code, { now });
    expect(first).toEqual(second);
    expect(first.ok && first.step).toBe(Math.floor(now / 30));
  });

  it("refuses the wrong code, and anything that is not six digits", () => {
    const right = generate(secret, { now });
    const wrong = right === "000000" ? "111111" : "000000";
    expect(verify(secret, wrong, { now })).toEqual({ ok: false });
    for (const bad of [
      "",
      "12345",
      "1234567",
      "abcdef",
      "12 34 56",
      "١٢٣٤٥٦",
    ]) {
      expect(verify(secret, bad, { now })).toEqual({ ok: false });
    }
  });

  it("ignores spaces inside an otherwise valid code", () => {
    const code = generate(secret, { now });
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verify(secret, spaced, { now })).toEqual({
      ok: true,
      step: Math.floor(now / 30),
    });
  });

  it("refuses rather than throws when the stored secret is corrupt", () => {
    expect(verify("not-base32!", "123456", { now })).toEqual({ ok: false });
  });

  it("does not accept another account's code", () => {
    const other = generateSecret();
    expect(verify(secret, generate(other, { now }), { now })).toEqual({
      ok: false,
    });
  });
});

describe("otpauthUrl", () => {
  it("names the issuer twice, in the label and the parameter", () => {
    const url = otpauthUrl({
      secret: "JBSWY3DPEHPK3PXP",
      account: "mirza@shareviral.cash",
      issuer: "ShareViral Finance",
    });
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("otpauth:");
    expect(parsed.searchParams.get("issuer")).toBe("ShareViral Finance");
    expect(parsed.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(parsed.searchParams.get("digits")).toBe("6");
    expect(parsed.searchParams.get("period")).toBe("30");
    expect(decodeURIComponent(parsed.pathname)).toContain(
      "ShareViral Finance:mirza@shareviral.cash",
    );
  });

  it("produces a URL an authenticator's own maths agrees with", () => {
    // End to end: make a secret, put it in a URL, read it back out the way a
    // phone would, and check the code matches.
    const secret = generateSecret();
    const url = otpauthUrl({ secret, account: "a@b.co", issuer: "SFM" });
    const scanned = new URL(url).searchParams.get("secret") as string;
    const now = 1_700_000_123;
    expect(generate(scanned, { now })).toBe(generate(secret, { now }));
  });
});
