import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { eq } from "drizzle-orm";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { appSettings } from "../../db/schema";
import { NotificationEventsService } from "./notification-events.service";
import { NotificationsService } from "./notifications.service";

/**
 * The bell.
 *
 * Reading and marking read carry no permission, deliberately: a notification
 * was raised *for* this person, and the only rows any of these touch are their
 * own. Requiring a permission to read your own bell would mean the roles that
 * lack it get notifications they cannot see.
 *
 * The switches are a different matter and sit behind `settings.write`, because
 * turning an event off decides what everybody else is told.
 */
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly events: NotificationEventsService,
  ) {}

  @Get()
  async list(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.forUser(actor.id);
  }

  @Post(":id/read")
  @HttpCode(200)
  async read(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markRead(actor.id, id);
  }

  @Post("read-all")
  @HttpCode(200)
  async readAll(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.markAllRead(actor.id);
  }

  /* --- the switches ------------------------------------------------------- */

  @Get("settings")
  @RequirePermission("settings.read")
  async settings() {
    const [row] = await this.db.client
      .select({
        renewals: appSettings.notifyRenewals,
        tdsDeadline: appSettings.notifyTdsDeadline,
        payrollUnpaid: appSettings.notifyPayrollUnpaid,
        significantChanges: appSettings.notifySignificantChanges,
      })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    return {
      renewals: row?.renewals ?? true,
      tdsDeadline: row?.tdsDeadline ?? true,
      payrollUnpaid: row?.payrollUnpaid ?? true,
      significantChanges: row?.significantChanges ?? false,
    };
  }

  @Post("settings")
  @HttpCode(200)
  @RequirePermission("settings.write")
  async updateSettings(
    @Body()
    body: {
      renewals?: boolean;
      tdsDeadline?: boolean;
      payrollUnpaid?: boolean;
      significantChanges?: boolean;
    },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.db.client
      .update(appSettings)
      .set({
        ...(body.renewals !== undefined
          ? { notifyRenewals: body.renewals }
          : {}),
        ...(body.tdsDeadline !== undefined
          ? { notifyTdsDeadline: body.tdsDeadline }
          : {}),
        ...(body.payrollUnpaid !== undefined
          ? { notifyPayrollUnpaid: body.payrollUnpaid }
          : {}),
        ...(body.significantChanges !== undefined
          ? { notifySignificantChanges: body.significantChanges }
          : {}),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(appSettings.id, 1));

    return { saved: true };
  }

  /**
   * Run the daily job now.
   *
   * The same reason the email screen has one: a job that only exists inside a
   * cron decorator cannot be tried without waiting until tomorrow, and "does
   * it find the right things" is the question worth answering before it
   * matters. Raising is idempotent, so pressing it twice raises once.
   */
  @Post("run")
  @HttpCode(200)
  @RequirePermission("settings.write")
  async run() {
    const raised = await this.events.run();
    return {
      raised,
      message:
        raised > 0
          ? `Raised ${raised} notification${raised === 1 ? "" : "s"}.`
          : "Nothing to raise, or everybody has already been told.",
    };
  }
}
