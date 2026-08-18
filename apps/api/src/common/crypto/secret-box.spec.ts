/**
 * This file had no tests until two-factor needed it.
 *
 * It was written for one caller — the assistant's Anthropic key — and is about
 * to hold something with a very different failure cost: the TOTP secret, which
 * is the only thing standing behind a password once passwords are assumed
 * leaked. Before leaning on it, it is worth knowing it does what its comments
 * say, particularly the two behaviours a second caller could easily inherit by
 * accident:
 *
 *   - `open()` returns null rather than throwing. That is right for an API key
 *     (a rotated server secret should show "no key configured", not break every
 *     settings request) and WRONG for a TOTP secret, where null must be treated
 *     as an error and never as "this user has no second factor". The tests
 *     below pin the behaviour so the 2FA caller can be written against it
 *     knowingly.
 *   - The key falls back to JWT_REFRESH_SECRET. Also deliberate, also worth
 *     knowing: rotating that secret orphans everything stored.
 */
import { hint, open, seal } from "./secret-box";

const withEnv = <T>(
  env: Record<string, string | undefined>,
  fn: () => T,
): T => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
  }
  try {
    return fn();
  } finally {
    process.env = saved;
  }
};

const KEY = { SECRET_ENCRYPTION_KEY: "a-test-key-of-more-than-sixteen-chars" };

describe("secret-box", () => {
  it("round-trips a secret", () =>
    withEnv(KEY, () => {
      const secret = "sk-ant-api03-abcdef1234567890";
      expect(open(seal(secret))).toBe(secret);
    }));

  it("gives different ciphertext each time, from a fresh iv", () =>
    withEnv(KEY, () => {
      const a = seal("SAME");
      const b = seal("SAME");
      expect(a).not.toBe(b);
      expect(open(a)).toBe("SAME");
      expect(open(b)).toBe("SAME");
    }));

  it("carries a version prefix and four parts", () =>
    withEnv(KEY, () => {
      const parts = seal("x").split(".");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
    }));

  it("cannot be read with a different key", () =>
    withEnv(KEY, () => {
      const sealed = seal("sk-ant-secret");
      // The whole point: a database dump without the environment is inert.
      return withEnv(
        { SECRET_ENCRYPTION_KEY: "an-entirely-different-key-here" },
        () => {
          expect(open(sealed)).toBeNull();
        },
      );
    }));

  it("returns null on a tampered payload rather than plausible nonsense", () =>
    withEnv(KEY, () => {
      const [v, iv, tag, body] = seal("sk-ant-secret").split(".");
      const flip = (s: string) =>
        s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`;
      // GCM is authenticated, so each of these must fail rather than decrypt.
      expect(open([v, iv, tag, flip(body)].join("."))).toBeNull();
      expect(open([v, flip(iv), tag, body].join("."))).toBeNull();
      expect(open([v, iv, flip(tag), body].join("."))).toBeNull();
    }));

  it("returns null for anything that is not a sealed value", () =>
    withEnv(KEY, () => {
      for (const junk of ["", "plain text", "v1.only.three", "v2.a.b.c"]) {
        expect(open(junk)).toBeNull();
      }
      expect(open(null)).toBeNull();
      expect(open(undefined)).toBeNull();
    }));

  it("falls back to the refresh secret when no dedicated key is set", () =>
    withEnv(
      {
        SECRET_ENCRYPTION_KEY: undefined,
        JWT_REFRESH_SECRET: "the-refresh-secret-value",
      },
      () => {
        expect(open(seal("works"))).toBe("works");
      },
    ));

  it("prefers the dedicated key over the refresh secret", () =>
    // Which is why rotating JWT_REFRESH_SECRET orphans stored secrets only on
    // installs that never set the dedicated one.
    withEnv({ ...KEY, JWT_REFRESH_SECRET: "something-else-entirely" }, () => {
      const sealed = seal("pinned");
      return withEnv(
        {
          SECRET_ENCRYPTION_KEY: undefined,
          JWT_REFRESH_SECRET: "something-else-entirely",
        },
        () => {
          expect(open(sealed)).toBeNull();
        },
      );
    }));

  it("throws when there is no key at all", () =>
    withEnv(
      { SECRET_ENCRYPTION_KEY: undefined, JWT_REFRESH_SECRET: undefined },
      () => {
        expect(() => seal("x")).toThrow(/SECRET_ENCRYPTION_KEY/);
        // open() swallows it, which is its documented contract.
        expect(open("v1.a.b.c")).toBeNull();
      },
    ));
});

describe("hint", () => {
  it("shows enough to recognise a key and not enough to use it", () => {
    expect(hint("sk-ant-api03-LONGSECRETVALUE-LTa4")).toBe("sk-ant-…LTa4");
  });

  it("refuses to reveal a short secret", () => {
    expect(hint("short")).toBe("…");
    expect(hint("exactly12chr")).toBe("…");
  });

  it("passes null through", () => {
    expect(hint(null)).toBeNull();
  });
});
