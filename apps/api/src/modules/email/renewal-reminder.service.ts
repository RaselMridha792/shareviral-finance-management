import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { formatMoney, todayInDhaka } from "@finance/shared";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { appSettings, subscriptions, users } from "../../db/schema";
import { EmailService } from "./email.service";

/**
 * "Claude renews on Thursday" — three days before it does.
 *
 * A renewal that arrives unannounced is a charge somebody finds on a statement
 * afterwards, by which point cancelling costs a month. Three days is enough to
 * cancel, change the plan, or make sure the card has room.
 *
 * The date arithmetic is Dhaka's, not the server's. A UTC box computing "three
 * days from today" is six hours behind, so for six hours a day it answers with
 * yesterday's date — which on the wrong side of a month boundary is a reminder
 * sent for the wrong renewal, or not sent at all.
 */

const KIND = "subscription_renewal";

@Injectable()
export class RenewalReminderService {
  private readonly log = new Logger(RenewalReminderService.name);

  constructor(
    private readonly db: DbService,
    private readonly email: EmailService,
  ) {}

  /**
   * Every morning at nine, Dhaka time.
   *
   * Not midnight: a reminder that lands at 3am is read at 9am anyway, and one
   * that lands while somebody is at their desk gets acted on. The timezone is
   * given to the scheduler rather than assumed, because this container runs on
   * UTC and always will.
   */
  @Cron("0 9 * * *", { timeZone: "Asia/Dhaka" })
  async daily() {
    const sent = await this.run();
    if (sent > 0) this.log.log(`Sent ${sent} renewal reminder(s).`);
  }

  /**
   * The job itself, separated from its schedule so it can be run by hand.
   *
   * Settings has a "send a test" button, and a job that only exists inside a
   * cron decorator cannot be tried without waiting until tomorrow.
   */
  async run(): Promise<number> {
    const config = await this.email.config();
    if (!config.ok) {
      // Not an error worth shouting about — most days this app has no mailer
      // configured at all, and a daily error log about a feature nobody has
      // switched on is noise that hides real ones.
      this.log.debug(`Skipping renewal reminders: ${config.reason}`);
      return 0;
    }

    const target = this.inThreeDays();

    const due = await this.db.client
      .select({
        id: subscriptions.id,
        toolName: subscriptions.toolName,
        planName: subscriptions.planName,
        costUsd: subscriptions.costUsd,
        costBdt: subscriptions.costBdt,
        billingCycle: subscriptions.billingCycle,
        loginEmail: subscriptions.loginEmail,
        websiteUrl: subscriptions.websiteUrl,
        renewsOn: subscriptions.nextRenewalOn,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.nextRenewalOn, target),
          // Only plans that are actually live. A cancelled plan does not renew,
          // and mailing about one is how people learn to ignore these.
          eq(subscriptions.status, "active"),
          isNull(subscriptions.deletedAt),
        ),
      );

    if (!due.length) return 0;

    let sent = 0;
    for (const plan of due) {
      const recipients = await this.recipientsFor(plan.loginEmail);
      const subject = `${plan.toolName} renews on ${target}`;
      const html = this.body(plan, target);

      for (const to of recipients) {
        const result = await this.email.sendOnce(config.config, {
          kind: KIND,
          subjectId: plan.id,
          subjectDate: target,
          to,
          subject,
          html,
        });
        if (result.ok && result.id !== "already-sent") sent += 1;
      }
    }

    return sent;
  }

  /**
   * Three days out, counted in Dhaka.
   *
   * `todayInDhaka()` returns an ISO date, so this walks it forward as a date
   * rather than adding milliseconds — 72 hours is not three days on the two
   * mornings a year a clock changes, and Bangladesh has tried daylight saving
   * before.
   */
  private inThreeDays(): string {
    const [y, m, d] = todayInDhaka().split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d));
    at.setUTCDate(at.getUTCDate() + 3);
    return at.toISOString().slice(0, 10);
  }

  /**
   * Everybody the owner asked for, de-duplicated.
   *
   * The login address, the CFOs, the super admins, and the admin address from
   * Settings. A Set because the same person is often two of those, and being
   * told twice about one renewal is the thing the sent-log exists to prevent —
   * it would be odd to reintroduce it here.
   */
  private async recipientsFor(loginEmail: string | null): Promise<string[]> {
    const to = new Set<string>();

    /*
     * The address the tool was bought with, if it is one.
     *
     * `loginEmail` is free text and always has been — it holds "shared
     * account", or two addresses, or a note. Sending to whatever is in it
     * would bounce for some rows and, on a provider that scores senders,
     * bouncing is what stops the rest arriving.
     */
    if (loginEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim())) {
      to.add(loginEmail.trim().toLowerCase());
    }

    const staff = await this.db.client
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(
        and(
          inArray(users.role, ["cfo", "super_admin"]),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      );
    for (const person of staff) to.add(person.email.toLowerCase());

    const [row] = await this.db.client
      .select({ admin: appSettings.emailAdminAddress })
      .from(appSettings)
      .where(
        and(eq(appSettings.id, 1), isNotNull(appSettings.emailAdminAddress)),
      )
      .limit(1);
    if (row?.admin) to.add(row.admin.toLowerCase());

    return [...to];
  }

  /**
   * The message.
   *
   * Plain, and it leads with what somebody has to decide rather than with a
   * greeting: what renews, when, and for how much. Inline styles because email
   * clients drop a stylesheet, and no images because half of them are blocked
   * by default and a reminder that renders as an empty box has failed.
   */
  private body(
    plan: {
      toolName: string;
      planName: string;
      costUsd: string;
      costBdt: string | null;
      billingCycle: string;
      websiteUrl: string | null;
    },
    on: string,
  ): string {
    const price = plan.costBdt
      ? `${formatMoney(plan.costBdt, { currency: "BDT" })} (${formatMoney(plan.costUsd, { currency: "USD" })})`
      : formatMoney(plan.costUsd, { currency: "USD" });

    const link = plan.websiteUrl
      ? `<p style="margin:16px 0 0"><a href="${plan.websiteUrl}" style="color:#4d7c0f">Open ${escapeHtml(plan.toolName)}</a></p>`
      : "";

    return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#18181b">
  <p style="margin:0 0 12px"><strong>${escapeHtml(plan.toolName)}</strong> renews on <strong>${on}</strong>.</p>
  <table style="border-collapse:collapse;margin:0 0 4px">
    <tr><td style="padding:2px 16px 2px 0;color:#71717a">Plan</td><td>${escapeHtml(plan.planName)}</td></tr>
    <tr><td style="padding:2px 16px 2px 0;color:#71717a">Cost</td><td>${price}</td></tr>
    <tr><td style="padding:2px 16px 2px 0;color:#71717a">Billed</td><td>${escapeHtml(plan.billingCycle)}</td></tr>
  </table>
  ${link}
  <p style="margin:20px 0 0;font-size:13px;color:#71717a">
    Three days' notice, so this can still be cancelled or changed.<br>
    Sent by ShareViral Finance.
  </p>
</div>`;
  }
}

/**
 * A tool's name goes into the message, and a tool's name is typed by a person.
 *
 * Nothing in this app currently has an apostrophe in a plan name, which is the
 * argument for doing this now rather than after something does.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
