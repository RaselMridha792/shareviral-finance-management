import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  BILLING_CYCLE_LABELS,
  formatMoney,
  todayInDhaka,
  type BillingCycle,
} from "@finance/shared";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { appSettings, subscriptions, users } from "../../db/schema";
import {
  button,
  detailPanel,
  detailRow,
  escapeHtml,
  layout,
} from "./email-layout";
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
    const { found, sent } = await this.run();
    if (found > 0) {
      this.log.log(`${found} plan(s) renewing; sent ${sent} reminder(s).`);
    }
  }

  /**
   * The job itself, separated from its schedule so it can be run by hand.
   *
   * Settings has a "send a test" button, and a job that only exists inside a
   * cron decorator cannot be tried without waiting until tomorrow.
   */
  async run(): Promise<{ found: number; sent: number }> {
    const config = await this.email.config();
    if (!config.ok) {
      // Not an error worth shouting about — most days this app has no mailer
      // configured at all, and a daily error log about a feature nobody has
      // switched on is noise that hides real ones.
      this.log.debug(`Skipping renewal reminders: ${config.reason}`);
      return { found: 0, sent: 0 };
    }

    /*
     * Anything renewing between today and three days out — not the one day
     * that happens to be exactly three days away.
     *
     * It used to match `nextRenewalOn = today + 3` exactly, and that has two
     * failures with the same shape. A plan added inside its own notice period
     * — bought on Monday, renewing Wednesday — was never reminded about at
     * all. And one missed run, from a restart or a deploy landing at nine in
     * the morning, silently spent that plan's only chance.
     *
     * A window cannot miss. Telling somebody twice is prevented by the sent
     * log rather than by the arithmetic, which is the right place for it:
     * `subject_date` is the plan's own renewal date, so one message goes per
     * plan per renewal however many mornings the window covers it.
     */
    const today = todayInDhaka();
    const horizon = this.plusDays(today, 3);

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
          gte(subscriptions.nextRenewalOn, today),
          lte(subscriptions.nextRenewalOn, horizon),
          // Only plans that are actually live. A cancelled plan does not renew,
          // and mailing about one is how people learn to ignore these.
          eq(subscriptions.status, "active"),
          isNull(subscriptions.deletedAt),
        ),
      );

    if (!due.length) return { found: 0, sent: 0 };

    let sent = 0;
    for (const plan of due) {
      const recipients = await this.recipientsFor(plan.loginEmail);
      // The plan's own date, not the end of the window: a plan renewing
      // tomorrow must not be described as renewing in three days.
      const on = plan.renewsOn ?? horizon;
      const subject = `${plan.toolName} renews on ${on}`;
      const html = this.body(plan, on);

      for (const to of recipients) {
        const result = await this.email.sendOnce(config.config, {
          kind: KIND,
          subjectId: plan.id,
          subjectDate: on,
          to,
          subject,
          html,
        });
        if (result.ok && result.id !== "already-sent") sent += 1;
      }
    }

    return { found: due.length, sent };
  }

  /**
   * A date walked forward as a date, in Dhaka.
   *
   * Not by adding milliseconds: 72 hours is not three days on the two mornings
   * a year a clock changes, and Bangladesh has tried daylight saving before.
   */
  private plusDays(from: string, days: number): string {
    const [y, m, d] = from.split("-").map(Number);
    const at = new Date(Date.UTC(y, m - 1, d));
    at.setUTCDate(at.getUTCDate() + days);
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

    const [row] = await this.db.client
      .select({
        admin: appSettings.emailAdminAddress,
        toStaff: appSettings.emailToStaff,
      })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    /*
     * The people who can sign in — unless the owner has said not to.
     *
     * A sign-in address is a login and not always a mailbox. Where it is not,
     * every reminder bounces, and a provider that scores senders counts those
     * against the mail that matters. So this is a switch rather than a rule.
     */
    if (row?.toStaff !== false) {
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
    }

    if (row?.admin) to.add(row.admin.toLowerCase());

    return [...to];
  }

  /**
   * The message.
   *
   * It leads with what somebody has to decide rather than with a greeting:
   * what renews, when, and for how much. The shape comes from `email-layout`,
   * which every message here shares — a header that identifies the sender at a
   * glance, because a renewal notice that looks like a stranger's is one
   * people learn to delete.
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
      ? `${formatMoney(plan.costBdt, { currency: "BDT" })} <span style="color:#71717a;font-weight:400">(${formatMoney(plan.costUsd, { currency: "USD" })})</span>`
      : formatMoney(plan.costUsd, { currency: "USD" });

    const rows = [
      detailRow("Plan", escapeHtml(plan.planName)),
      detailRow("Cost", price),
      detailRow(
        "Billed",
        escapeHtml(
          BILLING_CYCLE_LABELS[plan.billingCycle as BillingCycle] ??
            plan.billingCycle,
        ),
      ),
      detailRow("Renews on", escapeHtml(on)),
    ].join("");

    return layout({
      preview: `${plan.toolName} renews on ${on} — there is still time to change it.`,
      heading: `${plan.toolName} renews on ${on}`,
      body: `
        <div style="font-size:20px;font-weight:600;line-height:1.3;letter-spacing:-.01em">
          ${escapeHtml(plan.toolName)} renews on ${escapeHtml(on)}
        </div>
        <div style="margin:6px 0 0;color:#71717a;font-size:14px">
          This is a reminder while there is still time to cancel or change it.
        </div>
        ${detailPanel(rows)}
        ${plan.websiteUrl ? button(plan.websiteUrl, `Open ${plan.toolName}`) : ""}
      `,
    });
  }
}
