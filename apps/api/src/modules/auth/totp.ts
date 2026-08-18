/**
 * Time-based one-time passwords — RFC 6238, and RFC 4648 base32 to carry the
 * secret to a phone.
 *
 * Written out rather than pulled in. Three reasons, in order of weight:
 *
 *  1. RFC 6238 publishes test vectors. That makes `totp.spec.ts` an actual
 *     check against the standard rather than a recording of whatever this file
 *     happens to do — which is not true of most code, and is worth a lot on the
 *     one function standing between a leaked password and the salary table.
 *  2. It is about forty lines of HMAC. The usual argument for a dependency —
 *     "cryptography is too subtle to hand-roll" — is about primitives, and the
 *     primitive here is `crypto.createHmac`, which is Node's.
 *  3. One less package with a publish key, in an application whose own to-do
 *     list includes turning on dependency alerts.
 *
 * The parts that are easy to get wrong, and where they are handled:
 *
 *  - **Comparison must be constant-time.** `verify` uses `timingSafeEqual`; a
 *    `===` on the digits leaks, one character at a time, how much of a guess
 *    was right.
 *  - **Clock skew needs a window, and the window is an attack surface.** Every
 *    accepted step multiplies the guesses a brute-forcer gets. One step either
 *    side (±30s) is the usual compromise and the default here.
 *  - **A code must not work twice.** This file cannot enforce that — it has no
 *    storage — so `verify` returns the step it matched, and the caller is
 *    expected to refuse anything at or below the last step it accepted. Naming
 *    it in the return type is deliberate: a boolean would let a caller forget.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 4648 §6. No padding — `otpauth:` URIs do not carry it. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Phones and password managers put spaces in the key to make it readable,
  // and people paste it back with them.
  const clean = input.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = B32.indexOf(char);
    if (idx === -1) throw new Error(`"${char}" is not base32`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A new shared secret.
 *
 * 20 bytes because that is SHA-1's block-derived key length and what every
 * authenticator app expects; longer is not stronger here and some apps
 * silently truncate.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export type TotpOptions = {
  /** Seconds per code. 30 everywhere in practice. */
  step?: number;
  digits?: number;
  algorithm?: "sha1" | "sha256" | "sha512";
  /** Unix seconds. Injected so the tests can stand still. */
  now?: number;
};

/** HOTP — RFC 4226 §5.3. The counter is the time step for TOTP. */
function hotp(
  secret: Buffer,
  counter: number,
  digits: number,
  algorithm: "sha1" | "sha256" | "sha512",
): string {
  const buf = Buffer.alloc(8);
  // Node's writeBigUInt64BE, so the counter stays exact past 2^53. Time steps
  // will not reach that, but the function is also HOTP's, and HOTP counters
  // are whatever a caller makes them.
  buf.writeBigUInt64BE(BigInt(counter));

  const mac = createHmac(algorithm, secret).update(buf).digest();
  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** The code for a given moment. Mostly here so the tests and the QR agree. */
export function generate(secret: string, options: TotpOptions = {}): string {
  const { step = 30, digits = 6, algorithm = "sha1", now } = options;
  const seconds = now ?? Math.floor(Date.now() / 1000);
  return hotp(
    base32Decode(secret),
    Math.floor(seconds / step),
    digits,
    algorithm,
  );
}

export type VerifyResult =
  /**
   * `step` is the time step that matched. The caller MUST store it and reject
   * anything at or below it next time, or a code stays usable for its whole
   * window — long enough to be read over a shoulder and typed in again.
   */
  { ok: true; step: number } | { ok: false };

export function verify(
  secret: string,
  token: string,
  options: TotpOptions & { window?: number } = {},
): VerifyResult {
  const {
    step = 30,
    digits = 6,
    algorithm = "sha1",
    window = 1,
    now,
  } = options;

  const cleaned = token.replace(/\s/g, "");
  // Length is checked before any HMAC so a wrong-length guess costs nothing,
  // and so `timingSafeEqual` is never handed mismatched buffers (it throws).
  if (!new RegExp(`^\\d{${digits}}$`).test(cleaned)) return { ok: false };

  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return { ok: false };
  }

  const seconds = now ?? Math.floor(Date.now() / 1000);
  const current = Math.floor(seconds / step);
  const given = Buffer.from(cleaned);

  // Every candidate is compared, without an early return, so the *number* of
  // HMACs does not reveal which step matched.
  let matched = -1;
  for (let drift = -window; drift <= window; drift++) {
    const candidate = Buffer.from(
      hotp(key, current + drift, digits, algorithm),
    );
    if (timingSafeEqual(candidate, given)) matched = current + drift;
  }

  return matched === -1 ? { ok: false } : { ok: true, step: matched };
}

/**
 * The string behind the QR code.
 *
 * `issuer` is repeated in the label and the parameter on purpose — older apps
 * read one, newer ones read the other, and an account that shows up as a bare
 * email address among thirty others is the reason people delete the wrong one.
 */
export function otpauthUrl(opts: {
  secret: string;
  account: string;
  issuer: string;
  digits?: number;
  step?: number;
}): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(opts.digits ?? 6),
    period: String(opts.step ?? 30),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
