import { Body, Controller, Delete, Get, HttpCode, Post } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { seal } from "../../common/crypto/secret-box";
import { DbService } from "../../db/db.service";
import { appSettings } from "../../db/schema";
import { EmailService } from "./email.service";
import { RenewalReminderService } from "./renewal-reminder.service";

/**
 * Settings → Email.
 *
 * The key goes in and never comes back out. Every response carries a hint —
 * `re_ab…9f` — which is enough to answer "is the right key saved" and useless
 * to anybody reading a response they should not have.
 */
@Controller("email")
export class EmailController {
  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
    private readonly reminders: RenewalReminderService,
    private readonly audit: AuditService,
  ) {}

  @Get("status")
  @RequirePermission("settings.read")
  async status() {
    const [row] = await this.db.client
      .select({
        key: appSettings.resendApiKey,
        setAt: appSettings.resendKeySetAt,
        from: appSettings.emailFrom,
        admin: appSettings.emailAdminAddress,
        enabled: appSettings.emailEnabled,
      })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    const ready = await this.email.config();

    return {
      configured: Boolean(row?.key),
      keySetAt: row?.setAt ?? null,
      from: row?.from ?? null,
      adminAddress: row?.admin ?? null,
      enabled: row?.enabled ?? false,
      /** Null when it can send; otherwise the one thing still missing. */
      blockedBy: ready.ok ? null : ready.reason,
      recent: await this.email.recent(20),
    };
  }

  @Post("key")
  @RequirePermission("settings.write")
  async setKey(
    @Body() body: { apiKey?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const apiKey = (body.apiKey ?? "").trim();
    if (!apiKey.startsWith("re_")) {
      return { saved: false, message: "A Resend key starts with re_." };
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Set the Resend API key",
      module: "settings",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            resendApiKey: seal(apiKey),
            resendKeySetAt: new Date(),
            resendKeySetBy: actor.id,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
        return { saved: true, message: null };
      },
    });
  }

  @Delete("key")
  @RequirePermission("settings.write")
  async clearKey(@CurrentUser() actor: AuthenticatedUser) {
    return this.audit.mutate({
      action: "update",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Removed the Resend API key",
      module: "settings",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            resendApiKey: null,
            resendKeySetAt: null,
            resendKeySetBy: null,
            // Off with it. A switch left on over a key that is gone would put
            // the daily job into a failure it reports every morning.
            emailEnabled: false,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
        return { saved: true };
      },
    });
  }

  @Post("settings")
  @RequirePermission("settings.write")
  async update(
    @Body()
    body: { from?: string; adminAddress?: string; enabled?: boolean },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.audit.mutate({
      action: "update",
      entityTable: "app_settings",
      entityId: "1",
      summary: "Changed the email settings",
      module: "settings",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        await tx
          .update(appSettings)
          .set({
            ...(body.from !== undefined
              ? { emailFrom: body.from.trim() || null }
              : {}),
            ...(body.adminAddress !== undefined
              ? { emailAdminAddress: body.adminAddress.trim() || null }
              : {}),
            ...(body.enabled !== undefined
              ? { emailEnabled: body.enabled }
              : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(appSettings.id, 1));
        return { saved: true };
      },
    });
  }

  /**
   * Send one to yourself.
   *
   * The only honest way to know whether a domain is verified and a key works.
   * Everything before this point is a form that accepted some text.
   */
  @Post("test")
  @HttpCode(200)
  @RequirePermission("settings.write")
  async test(@CurrentUser() actor: AuthenticatedUser) {
    const config = await this.email.config();
    if (!config.ok) return { sent: false, message: config.reason };

    const result = await this.email.send(
      config.config,
      actor.email,
      "ShareViral Finance — test message",
      `<div style="font-family:system-ui,sans-serif;font-size:15px">
        <p>This is the test message from Settings → Email.</p>
        <p style="color:#71717a;font-size:13px">
          If it arrived, the key works and the domain is verified. Renewal
          reminders go out at 9am Dhaka time, three days before a plan renews.
        </p>
      </div>`,
    );

    return result.ok
      ? { sent: true, message: `Sent to ${actor.email}.` }
      : { sent: false, message: result.reason };
  }

  /**
   * Run the daily job now.
   *
   * Not a duplicate of the test: this proves the *reminder* works — that the
   * query finds the right plans and the recipient list is who it should be —
   * which waiting until tomorrow morning would otherwise be the only way to
   * learn. The sent-log still applies, so pressing it twice sends once.
   */
  @Post("run-reminders")
  @HttpCode(200)
  @RequirePermission("settings.write")
  async runReminders() {
    const sent = await this.reminders.run();
    return {
      sent,
      message:
        sent > 0
          ? `Sent ${sent} reminder${sent === 1 ? "" : "s"}.`
          : "Nothing renews in three days, or everybody has already been told.",
    };
  }
}
