/**
 * Encrypting the one secret that must survive the database being copied.
 *
 * Everything else in this application is safe in a dump because it is already
 * one-way: passwords are bcrypt, refresh tokens are SHA-256 of something the
 * server never stores. A TOTP secret cannot be hashed — the server has to
 * reproduce the code — so it is the single reversible secret in the schema.
 *
 * That matters here specifically because of where the dumps go. This one is
 * taken nightly and uploaded to Google Drive, off the machine, which is the
 * right thing to do and also means a copy of every row exists somewhere the
 * server's environment does not. Plaintext secrets in that file would hand
 * over the second factor along with the first, which is the whole thing that
 * two-factor is for.
 *
 * AES-256-GCM, one random 96-bit nonce per encryption, authentication tag
 * kept. GCM is authenticated: a tampered ciphertext fails to decrypt rather
 * than decrypting to something else, so a row edited in the database is a loud
 * error and not a silently wrong secret.
 *
 * The key comes from `TOTP_SECRET_KEY` and there is no fallback. A fallback
 * would mean the system quietly running in a weaker mode than whoever set it
 * up believes — and this evening has already spent enough on things that
 * looked fine while doing nothing.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class MissingSecretKeyError extends Error {
  constructor() {
    super(
      "TOTP_SECRET_KEY is not set. Two-factor cannot be enrolled or verified " +
        "without it. Generate one with `openssl rand -base64 32` and put it in " +
        "the API's environment.",
    );
    this.name = "MissingSecretKeyError";
  }
}

/**
 * The 32 bytes AES needs, from whatever length string the environment holds.
 *
 * SHA-256 of the configured value rather than the raw bytes, so a key pasted
 * as base64, as hex, or as a long passphrase all work and none of them fail at
 * three in the morning on "Invalid key length". It is not a KDF and does not
 * need to be: the input is expected to be 32 random bytes already, and
 * stretching a value that is already high-entropy buys nothing.
 */
function keyFrom(raw: string): Buffer {
  return createHash("sha256").update(raw, "utf8").digest();
}

function requireKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.TOTP_SECRET_KEY;
  if (!raw || !raw.trim()) throw new MissingSecretKeyError();
  return keyFrom(raw);
}

/** Whether enrolment can work at all. Lets a screen say so before it starts. */
export function secretKeyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.TOTP_SECRET_KEY && env.TOTP_SECRET_KEY.trim());
}

/**
 * `v1.<nonce>.<ciphertext+tag>`, all base64url.
 *
 * The version prefix is not decoration. Changing cipher later means rows
 * encrypted both ways living side by side for a while, and a format that
 * cannot say which is which has to guess.
 */
export function sealSecret(plain: string, env?: NodeJS.ProcessEnv): string {
  const key = requireKey(env);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}.${nonce.toString("base64url")}.${body.toString("base64url")}`;
}

export function openSecret(sealed: string, env?: NodeJS.ProcessEnv): string {
  const key = requireKey(env);

  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error(
      `Unrecognised sealed secret format: ${parts[0] ?? "empty"}`,
    );
  }

  const nonce = Buffer.from(parts[1], "base64url");
  const body = Buffer.from(parts[2], "base64url");
  if (nonce.length !== NONCE_BYTES || body.length <= TAG_BYTES) {
    throw new Error("Sealed secret is truncated");
  }

  const tag = body.subarray(body.length - TAG_BYTES);
  const ciphertext = body.subarray(0, body.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  // Throws "Unsupported state or unable to authenticate data" on a wrong key
  // or an edited row. Both are things a caller must not paper over.
  return (
    decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8")
  );
}
