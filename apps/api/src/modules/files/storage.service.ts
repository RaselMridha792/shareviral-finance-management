import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { extensionForMime } from "@finance/shared";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

export interface StoredFile {
  storageKey: string;
  checksum: string;
  sizeBytes: number;
}

/**
 * The bytes, and only the bytes. Everything about what a file *means* lives in
 * `FilesService`; this knows where things sit on disk and nothing else.
 *
 * Files are written under a date-shaded path — `2026/08/<uuid>.pdf`. Not for
 * tidiness: a single directory holding every file the company ever uploads
 * makes `readdir` and every backup pass slower each year, and by the time that
 * is noticeable it is a migration rather than a decision.
 *
 * The name on disk is a fresh UUID and an extension derived from the sniffed
 * content type. Nothing a person typed reaches the filesystem, so there is no
 * `../`, no reserved Windows name, no leading dash, and no case-collision on a
 * case-insensitive volume to reason about.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = path.resolve(process.env.UPLOAD_DIR ?? "./uploads");

  /**
   * Prove the directory exists and can be written to, at boot.
   *
   * A missing bind mount is invisible until the first upload, which is the
   * worst moment to discover it: the person uploading sees a 500, and the
   * cause is a line in docker-compose.yml nobody is looking at. This turns
   * that into a message at start-up, next to the deploy that caused it.
   */
  async onModuleInit(): Promise<void> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const probe = path.join(this.root, ".writable");
      await fs.writeFile(probe, "");
      await fs.unlink(probe);
      this.logger.log(`Uploads directory ready at ${this.root}`);
    } catch (error) {
      this.logger.error(
        `Uploads directory ${this.root} is not writable — uploads will fail. ${String(error)}`,
      );
    }
  }

  /** Where a stored key lands, refusing anything that climbs out of the root. */
  private absolute(storageKey: string): string {
    const resolved = path.resolve(this.root, storageKey);
    const withSeparator = this.root.endsWith(path.sep)
      ? this.root
      : this.root + path.sep;
    if (!resolved.startsWith(withSeparator)) {
      // These keys come from this application's own database, so reaching here
      // means either a bug or a database somebody else can write to. Both are
      // worth refusing loudly rather than reading whatever was asked for.
      throw new Error(`Refusing a storage key outside the root: ${storageKey}`);
    }
    return resolved;
  }

  async write(buffer: Buffer, mimeType: string): Promise<StoredFile> {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const name = `${randomUUID()}.${extensionForMime(mimeType)}`;

    const storageKey = path.posix.join(year, month, name);
    const target = this.absolute(storageKey);

    await fs.mkdir(path.dirname(target), { recursive: true });
    // wx: never overwrite. A UUID collision is not going to happen, but the
    // failure mode if it did is one person's document replacing another's, and
    // the flag costs nothing.
    await fs.writeFile(target, buffer, { flag: "wx" });

    return {
      storageKey,
      checksum: createHash("sha256").update(buffer).digest("hex"),
      sizeBytes: buffer.byteLength,
    };
  }

  stream(storageKey: string): ReturnType<typeof createReadStream> {
    return createReadStream(this.absolute(storageKey));
  }

  /**
   * The whole file in memory.
   *
   * `stream` is what every download uses and is the right default. This exists
   * for the one caller that has to *embed* bytes rather than send them — the
   * statement PDF, which draws a signature onto its closing page. The only
   * kinds read this way are signatures, capped at 300 KB by
   * `checkSignatureImage`, so the buffer is small and bounded.
   */
  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.absolute(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.absolute(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  /** The sha256 of what is on disk now, for the restore drill to compare. */
  async checksumOf(storageKey: string): Promise<string> {
    const buffer = await fs.readFile(this.absolute(storageKey));
    return createHash("sha256").update(buffer).digest("hex");
  }

  /**
   * Removes the bytes. Missing is success: this is called when a row is being
   * soft-deleted, and refusing to finish because the file was already gone
   * would leave a record that says "present" about nothing.
   */
  async remove(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.absolute(storageKey));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
}
