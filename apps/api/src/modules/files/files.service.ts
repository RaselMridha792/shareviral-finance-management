import {
  ALLOWED_MIME_TYPES,
  checkPrintableSignature,
  checkSignatureImage,
  readImageSize,
  COMPENSATION_FILE_KINDS,
  FILE_KIND_LABELS,
  hasPermission,
  isImageMime,
  KINDS_BY_OWNER,
  MAX_FILE_BYTES,
  safeDisplayName,
  SIGNATURE_KINDS,
  type FileDto,
  type FileKind,
  type FileOwner,
  type Permission,
  type UploadFileInput,
} from "@finance/shared";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { files, users, type FileRow } from "../../db/schema";
import { sniffMime } from "./sniff";
import { StorageService } from "./storage.service";

/**
 * Kinds where a second file replaces the first.
 *
 * Only the photo. It is rendered as *the* picture of a person, so two active
 * ones means the screens have to pick, and "the newest" is a rule invented in
 * whichever component was written last. Documents are left plural on purpose —
 * a scanned appointment letter is regularly two files.
 */
const SINGULAR_KINDS: readonly FileKind[] = [
  "profile_photo",
  /**
   * And the plan screenshot, for the same reason: it is rendered as *the*
   * picture of the plan, opened by clicking the tool's name. Two of them means
   * a screen has to pick, and "the newest" is a rule invented in whichever
   * component was written last.
   */
  "subscription_screenshot",
  /**
   * And the signatures, most of all. Each is printed as *the* mark in its own
   * block on a payslip; two on file for one block would mean the slip had to
   * choose. Both are here, not just the first — a rule that covers one of two
   * identical things is a rule somebody will trip over.
   */
  "signature",
  "prepared_signature",
  /**
   * And the challan. It is opened from a challan number as *the* paper behind
   * that number, so two of them means the register has to pick one — and
   * "the newest" would be a rule invented in whichever screen drew it last.
   * Attaching another replaces it, which is what the form already says it
   * does.
   */
  "challan",
];

/** Which permission a file's owner demands, to read it and to change it. */
const OWNER_PERMISSIONS: Record<
  FileOwner,
  { read: Permission; write: Permission }
> = {
  team_member: { read: "team.read", write: "team.write" },
  transaction: { read: "transactions.read", write: "transactions.write" },
  import_batch: { read: "imports.run", write: "imports.run" },
  // The same pair the register itself is gated on — a screenshot of a plan is
  // the plan, and a second boundary around it would have to be granted to
  // exactly the same people.
  subscription: { read: "vendors.read", write: "vendors.write" },
  // The company's signature is part of its letterhead, which is a setting —
  // and everybody who can read a payslip can already see it printed on one.
  settings: { read: "settings.read", write: "settings.write" },
  // The same pair the deposit itself is gated on. A challan's scan is the
  // proof the deposit happened; whoever may record one may attach it, and
  // whoever may read the register may see it.
  tds_deposit: { read: "tds.read", write: "tds.write" },
  // The withholding register's own pair. What hangs on a payroll line here is
  // the challan its tax was deposited under, and it is read and written on
  // that screen — `payroll.read` guards the payslip, which is a different
  // document answering a different question.
  payroll_line: { read: "tds.read", write: "tds.write" },
  // The run's own pair, exactly as `PayrollController` gates the sheet.
  // Whoever may read a salary sheet may see the paper behind it, and whoever
  // may edit one may attach it — deliberately not `payroll.pay`, because the
  // invoice is filed while the run is still a draft.
  payroll_run: { read: "payroll.read", write: "payroll.write" },
  // The statement's own pair, exactly as `ReportsController` gates the page:
  // `reports.view` to read it, `transactions.write` to change it. Whoever may
  // reconcile a period may say who signed it and attach their hand; whoever
  // may read the statement may see the signature printed on it.
  statement: { read: "reports.view", write: "transactions.write" },
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly db: DbService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Permissions                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * A file is exactly as private as the thing it hangs on.
   *
   * Deliberately no `files.read` permission of its own. A parallel vocabulary
   * would be one more list to keep in step with the first, and the day they
   * disagree is the day a document is readable by somebody who cannot open the
   * record it belongs to.
   */
  private ownerOf(row: FileRow): { owner: FileOwner; id: string } {
    if (row.teamMemberId) return { owner: "team_member", id: row.teamMemberId };
    if (row.transactionId)
      return { owner: "transaction", id: row.transactionId };
    if (row.importBatchId)
      return { owner: "import_batch", id: row.importBatchId };
    if (row.subscriptionId)
      return { owner: "subscription", id: row.subscriptionId };
    if (row.settingsId)
      return { owner: "settings", id: String(row.settingsId) };
    /*
     * These two were missing, which made a challan scan unreadable even where
     * one could be stored: `open` calls this before it streams, so a file
     * owned by a deposit answered "not attached to anything" — a 404 on a file
     * that was right there. The table's own constraint had the same gap and is
     * repaired in 2026-08-21-tds-line-challan.sql.
     */
    if (row.tdsDepositId) return { owner: "tds_deposit", id: row.tdsDepositId };
    if (row.payrollLineId)
      return { owner: "payroll_line", id: row.payrollLineId };
    if (row.payrollRunId) return { owner: "payroll_run", id: row.payrollRunId };
    if (row.statementId) return { owner: "statement", id: row.statementId };
    // The table has a check constraint making this unreachable. If it is ever
    // reached, refusing is the only safe reading of a file owned by nothing.
    throw new NotFoundException("This file is not attached to anything");
  }

  private assertAccess(
    row: FileRow,
    actor: AuthenticatedUser,
    mode: "read" | "write",
  ): void {
    const { owner } = this.ownerOf(row);
    const needed = OWNER_PERMISSIONS[owner][mode];
    if (!hasPermission(actor.role, needed)) {
      throw new ForbiddenException(
        `Your role cannot do this (needs ${needed})`,
      );
    }

    // An appointment letter states the salary on its face. Reading the team
    // directory is not the same as reading that.
    if (COMPENSATION_FILE_KINDS.includes(row.kind)) {
      const extra: Permission =
        mode === "read" ? "team.compensation.read" : "team.compensation.write";
      if (!hasPermission(actor.role, extra)) {
        throw new ForbiddenException(
          `${FILE_KIND_LABELS[row.kind]} carries a pay figure (needs ${extra})`,
        );
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reading                                                                */
  /* ---------------------------------------------------------------------- */

  private toDto(row: FileRow, uploadedByName: string | null = null): FileDto {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      isImage: isImageMime(row.mimeType),
      uploadedBy: row.uploadedBy,
      uploadedByName,
      createdAt: row.createdAt.toISOString(),
      // Relative to the API root, which is where the browser's client already
      // points. Never a path on disk, and never a URL nginx would answer on
      // its own — every read of these bytes goes through assertAccess above.
      url: `/files/${row.id}/content`,
    };
  }

  private ownerColumn(owner: FileOwner) {
    // A lookup rather than a chain of ternaries: the chain had no branch for a
    // new owner and would have silently filed one under import batches.
    // `satisfies` rather than an annotation: it still fails to compile when a
    // new owner is added without a column here, but it does not flatten four
    // distinct column types into the first one's.
    const columns = {
      team_member: files.teamMemberId,
      transaction: files.transactionId,
      import_batch: files.importBatchId,
      subscription: files.subscriptionId,
      settings: files.settingsId,
      tds_deposit: files.tdsDepositId,
      payroll_line: files.payrollLineId,
      payroll_run: files.payrollRunId,
      statement: files.statementId,
    } satisfies Record<FileOwner, unknown>;
    return columns[owner];
  }

  async listFor(
    owner: FileOwner,
    ownerId: string,
    actor: AuthenticatedUser,
    /**
     * Kinds to leave out.
     *
     * The documents list on a person passes `profile_photo`, because the
     * photograph has its own control beside the face it belongs to. Listing it
     * again underneath makes it look like two files, and the delete button in
     * that list removes the picture from the top of the page without ever
     * saying so.
     */
    exclude: readonly FileKind[] = [],
  ): Promise<FileDto[]> {
    const rows = await this.db.client
      .select({ file: files, uploaderName: users.fullName })
      .from(files)
      .leftJoin(users, eq(users.id, files.uploadedBy))
      .where(and(eq(this.ownerColumn(owner), ownerId), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt));

    // Filtered rather than refused: a role that can read the person but not
    // their appointment letter should see the rest of the list, not a 403 that
    // makes the whole tab look broken.
    return rows
      .filter((r) => !exclude.includes(r.file.kind))
      .filter(
        (r) =>
          !COMPENSATION_FILE_KINDS.includes(r.file.kind) ||
          hasPermission(actor.role, "team.compensation.read"),
      )
      .map((r) => this.toDto(r.file, r.uploaderName));
  }

  /** The row plus a stream, once the caller has been allowed to have it. */
  async open(id: string, actor: AuthenticatedUser) {
    const [row] = await this.db.client
      .select()
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such file");
    this.assertAccess(row, actor, "read");

    if (!(await this.storage.exists(row.storageKey))) {
      // The row says the file is here and the disk disagrees. Say so plainly
      // rather than streaming an empty response that looks like a corrupt
      // download — this is what a restore that missed the uploads looks like.
      throw new NotFoundException(
        "This file is recorded but its contents are missing from the server",
      );
    }

    return { row, stream: this.storage.stream(row.storageKey) };
  }

  /**
   * The bytes themselves, for a document that *embeds* a file rather than
   * serving it.
   *
   * The statement PDF draws each signatory's mark onto the closing page, so it
   * needs the image in hand rather than a URL a reader's browser would fetch —
   * a PDF is a single file that has to work on a laptop with no session.
   *
   * Null rather than an exception at every step where the answer is "there is
   * no usable image here": the file was removed, the actor may not read it, or
   * the row survived a restore that missed the disk. None of those is a reason
   * to fail the whole export — the page prints a ruled line with a name over
   * it, exactly as it did before signatures existed.
   */
  async bytes(id: string, actor: AuthenticatedUser): Promise<Buffer | null> {
    const [row] = await this.db.client
      .select()
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);

    if (!row) return null;
    try {
      this.assertAccess(row, actor, "read");
    } catch {
      return null;
    }

    try {
      return await this.storage.read(row.storageKey);
    } catch (error) {
      this.logger.warn(
        `File ${id} is recorded but could not be read: ${String(error)}`,
      );
      return null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Writing                                                                */
  /* ---------------------------------------------------------------------- */

  async upload(
    owner: FileOwner,
    ownerId: string,
    input: UploadFileInput,
    upload: Express.Multer.File,
    actor: AuthenticatedUser,
  ): Promise<FileDto> {
    const { kind } = input;

    if (!KINDS_BY_OWNER[owner].includes(kind)) {
      throw new BadRequestException(
        `A ${FILE_KIND_LABELS[kind].toLowerCase()} cannot be attached here`,
      );
    }

    if (COMPENSATION_FILE_KINDS.includes(kind)) {
      if (!hasPermission(actor.role, "team.compensation.write")) {
        throw new ForbiddenException(
          `${FILE_KIND_LABELS[kind]} carries a pay figure (needs team.compensation.write)`,
        );
      }
    }

    if (!upload?.buffer?.length) {
      throw new BadRequestException("The file was empty");
    }

    const limit = MAX_FILE_BYTES[kind];
    if (upload.size > limit) {
      throw new BadRequestException(
        `Too large — ${FILE_KIND_LABELS[kind]} is limited to ${Math.round(limit / (1024 * 1024))} MB`,
      );
    }

    /**
     * What it is, decided by reading it.
     *
     * The error names both sides on purpose. "Unsupported file type" sends
     * somebody to convert a file that was already the right format, when what
     * actually happened is that a .pdf was a renamed .docx.
     */
    const mimeType = sniffMime(upload.buffer, upload.mimetype);
    if (!mimeType) {
      throw new BadRequestException(
        `Could not recognise this file. Allowed here: ${ALLOWED_MIME_TYPES[kind].join(", ")}`,
      );
    }
    if (!ALLOWED_MIME_TYPES[kind].includes(mimeType)) {
      throw new BadRequestException(
        `This file is a ${mimeType}, which is not allowed for ${FILE_KIND_LABELS[kind].toLowerCase()}. Allowed: ${ALLOWED_MIME_TYPES[kind].join(", ")}`,
      );
    }

    /**
     * A signature has to be the right shape, not merely the right format.
     *
     * The same function the Settings screen calls before it uploads, so the
     * words on screen and this refusal cannot say different things — and the
     * dimensions come from the bytes rather than from anything the browser
     * claimed, because the browser is where the first check already ran.
     *
     * Both signature kinds go through it. The statement's closing page prints
     * a signatory's mark the same way a payslip prints the company's, and a
     * rule that held in one place and not the other would be found by whoever
     * uploaded a 2 MB photograph of a whiteboard.
     */
    if (SIGNATURE_KINDS.includes(kind)) {
      const size = readImageSize(upload.buffer);
      const verdict = size
        ? checkSignatureImage({
            ...size,
            sizeBytes: upload.buffer.byteLength,
            mimeType,
          })
        : ({
            ok: false,
            reason: "That file does not read as an image.",
          } as const);

      if (!verdict.ok) throw new BadRequestException(verdict.reason);

      /*
       * And one more, for the mark that ends up inside a PDF rather than
       * inside a web page. An interlaced PNG or a progressive JPEG opens fine
       * everywhere a person would check it and cannot be embedded in the
       * statement at all — which would surface a month later as an empty
       * signature box on the one document that leaves the company.
       */
      if (kind === "statement_signature") {
        const printable = checkPrintableSignature(upload.buffer);
        if (!printable.ok) throw new BadRequestException(printable.reason);
      }
    }

    const stored = await this.storage.write(upload.buffer, mimeType);

    /**
     * The keys a replacement retires, so their bytes can go once it commits.
     *
     * Without this every new photograph left the old one on disk for good.
     * Nothing referenced it, nothing could reach it, and nothing said so —
     * eleven files on the server against two the database knew about, which
     * only showed up because the backup counts both. It is the leak the
     * orphan sweep exists to catch, and this stops writing them.
     */
    const retired: string[] = [];

    try {
      const row = await this.audit.mutate({
        action: "create",
        entityTable: "files",
        module: "files",
        isSensitive: COMPENSATION_FILE_KINDS.includes(kind),
        summary: `Attached ${FILE_KIND_LABELS[kind].toLowerCase()} ${safeDisplayName(upload.originalname)}`,
        // Nothing to read before a create; the inserted row is the "after".
        read: () => Promise.resolve(undefined),
        run: async (tx) => {
          // The photo is singular, so the one it replaces stops being current
          // in the same transaction that makes the new one current. Doing this
          // afterwards would leave a window with two.
          if (SINGULAR_KINDS.includes(kind)) {
            const gone = await tx
              .update(files)
              .set({ deletedAt: new Date(), deletedBy: actor.id })
              .where(
                and(
                  eq(this.ownerColumn(owner), ownerId),
                  eq(files.kind, kind),
                  isNull(files.deletedAt),
                ),
              )
              .returning({ storageKey: files.storageKey });

            retired.push(...gone.map((g) => g.storageKey));
          }

          const [inserted] = await tx
            .insert(files)
            .values({
              storageKey: stored.storageKey,
              originalName: safeDisplayName(upload.originalname),
              mimeType,
              sizeBytes: stored.sizeBytes,
              checksum: stored.checksum,
              kind,
              label: input.label ?? null,
              teamMemberId: owner === "team_member" ? ownerId : null,
              transactionId: owner === "transaction" ? ownerId : null,
              importBatchId: owner === "import_batch" ? ownerId : null,
              subscriptionId: owner === "subscription" ? ownerId : null,
              tdsDepositId: owner === "tds_deposit" ? ownerId : null,
              payrollLineId: owner === "payroll_line" ? ownerId : null,
              payrollRunId: owner === "payroll_run" ? ownerId : null,
              statementId: owner === "statement" ? ownerId : null,
              // The one owner keyed by a number rather than a uuid.
              settingsId: owner === "settings" ? Number(ownerId) : null,
              uploadedBy: actor.id,
            })
            .returning();

          return inserted;
        },
      });

      /**
       * After the commit, never inside it.
       *
       * `unlink` cannot be rolled back. Removing the old photograph inside the
       * transaction would mean a later failure leaves the record saying the
       * previous file is current while its bytes are already gone — which is a
       * broken image with no way back, rather than a file nobody points at.
       */
      for (const key of retired) {
        await this.storage.remove(key).catch((caught: unknown) => {
          this.logger.error(
            `Replaced ${key} but could not delete it: ${String(caught)}`,
          );
        });
      }

      return this.toDto(row, actor.fullName);
    } catch (error) {
      /**
       * The bytes were written before the row, because a row pointing at a
       * file that is not there is worse than a file no row points at: the
       * first is a broken download, the second is disk nobody notices.
       *
       * If the insert failed anyway — a foreign key that does not exist is the
       * likely one — take the bytes back out, or this becomes exactly the leak
       * it was avoiding.
       */
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const [row] = await this.db.client
      .select()
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundException("No such file");
    this.assertAccess(row, actor, "write");

    await this.audit.mutate({
      action: "delete",
      entityTable: "files",
      entityId: row.id,
      module: "files",
      isSensitive: COMPENSATION_FILE_KINDS.includes(row.kind),
      summary: `Removed ${FILE_KIND_LABELS[row.kind].toLowerCase()} ${row.originalName}`,
      read: async (tx) => {
        const [current] = await tx
          .select()
          .from(files)
          .where(eq(files.id, id))
          .limit(1);
        return current;
      },
      run: async (tx) => {
        await tx
          .update(files)
          .set({ deletedAt: new Date(), deletedBy: actor.id })
          .where(eq(files.id, id));
      },
    });

    /**
     * The bytes go after the commit, not inside it.
     *
     * `unlink` cannot be rolled back, so doing it inside the transaction would
     * mean a later failure leaves a committed-looking record whose file is
     * already gone. This way the worst case is a file left on disk, which the
     * sweep below reports rather than losing data.
     */
    try {
      await this.storage.remove(row.storageKey);
    } catch (error) {
      this.logger.error(
        `Removed the record for ${row.id} but could not delete ${row.storageKey}: ${String(error)}`,
      );
    }
  }
}
