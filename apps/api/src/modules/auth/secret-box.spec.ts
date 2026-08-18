import {
  MissingSecretKeyError,
  openSecret,
  sealSecret,
  secretKeyConfigured,
} from "./secret-box";

const KEY = { TOTP_SECRET_KEY: "kQ0m5x8ZTt7yq2vJ1cW4nR6bS9dF3gH5jK7lM0pN2rQ=" };
const OTHER = {
  TOTP_SECRET_KEY: "different-key-entirely-but-still-32-bytes-ok",
};

describe("secret-box", () => {
  it("round-trips a secret", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    expect(openSecret(sealSecret(secret, KEY), KEY)).toBe(secret);
  });

  it("produces different ciphertext every time", () => {
    // A fresh nonce per call. Without it, two people enrolling with the same
    // secret would be visibly the same row, and GCM with a repeated nonce is
    // catastrophic rather than merely untidy.
    const a = sealSecret("SAME", KEY);
    const b = sealSecret("SAME", KEY);
    expect(a).not.toBe(b);
    expect(openSecret(a, KEY)).toBe(openSecret(b, KEY));
  });

  it("carries a version prefix", () => {
    expect(sealSecret("x", KEY).startsWith("v1.")).toBe(true);
  });

  it("refuses to decrypt with the wrong key", () => {
    // The point of the whole file: a dump without the environment is inert.
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", KEY);
    expect(() => openSecret(sealed, OTHER)).toThrow();
  });

  it("refuses a tampered ciphertext rather than returning something else", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", KEY);
    const [v, nonce, body] = sealed.split(".");
    // Flip one character of the payload.
    const flipped = body[0] === "A" ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(() => openSecret(`${v}.${nonce}.${flipped}`, KEY)).toThrow();
  });

  it("refuses a tampered nonce", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", KEY);
    const [v, nonce, body] = sealed.split(".");
    const flipped =
      nonce[0] === "A" ? `B${nonce.slice(1)}` : `A${nonce.slice(1)}`;
    expect(() => openSecret(`${v}.${flipped}.${body}`, KEY)).toThrow();
  });

  it("rejects an unknown format instead of guessing", () => {
    expect(() => openSecret("v2.aaaa.bbbb", KEY)).toThrow(/Unrecognised/);
    expect(() => openSecret("not-sealed-at-all", KEY)).toThrow();
    expect(() => openSecret("", KEY)).toThrow();
  });

  it("rejects a truncated payload", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", KEY);
    const [v, nonce] = sealed.split(".");
    expect(() => openSecret(`${v}.${nonce}.AAAA`, KEY)).toThrow(/truncated/);
  });

  it("says clearly when the key is missing, and does not invent one", () => {
    // No fallback is the point. A default key would mean every install shares
    // one, and nobody would ever find out.
    expect(() => sealSecret("x", {})).toThrow(MissingSecretKeyError);
    expect(() => sealSecret("x", { TOTP_SECRET_KEY: "   " })).toThrow(
      MissingSecretKeyError,
    );
    expect(() => sealSecret("x", {})).toThrow(/TOTP_SECRET_KEY/);
  });

  it("reports whether it is configured, so a screen can say so first", () => {
    expect(secretKeyConfigured(KEY)).toBe(true);
    expect(secretKeyConfigured({})).toBe(false);
    expect(secretKeyConfigured({ TOTP_SECRET_KEY: "" })).toBe(false);
    expect(secretKeyConfigured({ TOTP_SECRET_KEY: "  " })).toBe(false);
  });

  it("accepts a key given as base64, as hex, or as a passphrase", () => {
    for (const raw of [
      "kQ0m5x8ZTt7yq2vJ1cW4nR6bS9dF3gH5jK7lM0pN2rQ=",
      "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
      "a long passphrase somebody typed instead of running openssl",
    ]) {
      const env = { TOTP_SECRET_KEY: raw };
      expect(openSecret(sealSecret("JBSWY3DPEHPK3PXP", env), env)).toBe(
        "JBSWY3DPEHPK3PXP",
      );
    }
  });
});
