import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * Encrypts a secret before it is written to the database.
 *
 * The Anthropic key is the first thing this app stores that is valuable to
 * somebody else on its own: a database dump, a stray backup, or a Neon support
 * ticket would otherwise hand over a working billing credential. A password
 * hash is useless to a thief; an API key is not.
 *
 * AES-256-GCM, so tampering fails loudly rather than decrypting to nonsense.
 * The key is derived from a server secret that lives only in the environment,
 * which is what makes the database alone insufficient.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

/**
 * Derived from SECRET_ENCRYPTION_KEY, or from the refresh-token secret when
 * that is not set.
 *
 * Falling back is deliberate: an operator who upgrades and does not read the
 * release notes gets working encryption rather than a crash or, worse, a
 * plaintext key in a column. Setting the dedicated variable is still better,
 * because then rotating the JWT secret does not orphan the stored key.
 */
function derivedKey(): Buffer {
  /*
   * `||` and a trim, not `??`.
   *
   * `??` falls back on null and undefined, and an unset variable in a Docker
   * Compose file is neither: `SECRET_ENCRYPTION_KEY: ${SECRET_ENCRYPTION_KEY}`
   * with nothing in `.env` hands the container an empty string. So the
   * fallback written for exactly this case never fired, and production threw
   * "cannot encrypt a stored secret" while every developer machine — where
   * the variable is genuinely absent — worked.
   *
   * A whitespace-only value is the same mistake wearing a space.
   */
  const source =
    process.env.SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_REFRESH_SECRET?.trim();

  if (!source) {
    throw new Error(
      "Cannot encrypt a stored secret: set SECRET_ENCRYPTION_KEY (or JWT_REFRESH_SECRET) on the API.",
    );
  }

  // sha256 gives exactly the 32 bytes AES-256 wants, whatever the input length.
  return createHash("sha256").update(source, "utf8").digest();
}

/** `v1.<iv>.<authTag>.<ciphertext>`, all base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null rather than throwing when the value cannot be read.
 *
 * That happens for a real reason — the server secret was rotated, so every
 * stored secret is now unreadable. The app should say "no key is configured"
 * and let a Super Admin enter it again, not fail every request that happens to
 * touch settings.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, iv, tag, ciphertext] = parts;
    const decipher = createDecipheriv(
      ALGORITHM,
      derivedKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * `sk-ant-…LTa4` — enough to recognise which key is stored, not enough to use.
 *
 * Shown so a Super Admin can tell whether the key in the app is the one they
 * think it is, without the app ever sending the key itself to a browser.
 */
export function hint(secret: string | null): string | null {
  if (!secret) return null;
  const head = secret.slice(0, 7);
  const tail = secret.slice(-4);
  return secret.length <= 12 ? "…" : `${head}…${tail}`;
}
