import { ForbiddenException, Injectable } from "@nestjs/common";
import type {
  IsoDate,
  LockBooksInput,
  UpdateSettingsInput,
} from "@finance/shared";
import { eq } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { appSettings, type AppSettings } from "../../db/schema";

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The settings row, creating it on first read.
   *
   * Self-healing beats a migration that inserts it, because a database
   * restored from a dump taken before the row existed would otherwise 500 on
   * every request.
   */
  async get(): Promise<AppSettings> {
    const [existing] = await this.db.client
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    if (existing) return existing;

    const [created] = await this.db.client
      .insert(appSettings)
      .values({ id: 1 })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    // Another request created it between our select and insert.
    const [row] = await this.db.client
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    return row;
  }

  async update(input: UpdateSettingsInput, actor: AuthenticatedUser) {
    await this.get(); // ensure the row exists

    return this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: describeChange(input),
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(appSettings)
          .set({ ...input, updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(appSettings.id, 1))
          .returning();
        return row;
      },
    });
  }

  /**
   * Closes the books through a date. Nothing dated on or before it can be
   * created, edited, or voided afterwards.
   */
  async lockBooks(input: LockBooksInput, actor: AuthenticatedUser) {
    const current = await this.get();

    // Moving the lock backwards reopens a period that has already been
    // reported on, which is exactly what the lock exists to prevent.
    if (
      input.booksLockedThrough &&
      current.booksLockedThrough &&
      input.booksLockedThrough < current.booksLockedThrough
    ) {
      throw new ForbiddenException(
        `The books are already closed through ${current.booksLockedThrough}. Reopening an earlier period needs the lock cleared first.`,
      );
    }

    return this.audit.mutate({
      action: "settings_change",
      entityTable: "app_settings",
      entityId: "1",
      summary: input.booksLockedThrough
        ? `Closed the books through ${input.booksLockedThrough}`
        : "Reopened the books",
      module: "settings",
      read: async (tx) => {
        const [row] = await tx
          .select({ booksLockedThrough: appSettings.booksLockedThrough })
          .from(appSettings)
          .where(eq(appSettings.id, 1))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const [row] = await tx
          .update(appSettings)
          .set({
            booksLockedThrough: input.booksLockedThrough,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1))
          .returning();
        return row;
      },
    });
  }

  /**
   * Throws when `date` falls inside a closed period.
   * Every money-writing service calls this before saving.
   */
  async assertPeriodOpen(date: IsoDate): Promise<void> {
    const settings = await this.get();
    const locked = settings.booksLockedThrough;
    if (locked && date <= locked) {
      throw new ForbiddenException(
        `The books are closed through ${locked}. Ask a Super Admin to reopen them to change anything dated ${date}.`,
      );
    }
  }
}

function describeChange(input: UpdateSettingsInput): string {
  const readable: Record<string, string> = {
    companyName: "company name",
    companyEtin: "company e-TIN",
    companyBin: "company BIN",
    companyAddress: "company address",
    fiscalYearMode: "financial year",
    numberFormat: "number format",
    fxMode: "exchange rate source",
    fxFixedUsdBdt: "fixed USD rate",
    fxProvider: "rate provider",
    fxReportBasis: "which rate reports use",
    tdsReminderDays: "deadline reminder window",
  };
  const changed = Object.keys(input)
    .map((key) => readable[key] ?? key)
    .join(", ");
  return `Changed settings: ${changed}`;
}
