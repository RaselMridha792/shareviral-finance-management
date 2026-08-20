import { Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";

import { open } from "../../common/crypto/secret-box";
import { DbService } from "../../db/db.service";
import { appSettings, notificationLog } from "../../db/schema";

/**
 * The one place this app sends mail from.
 *
 * Resend's HTTP API rather than an SMTP client, because the thing that
 * actually decides whether mail arrives is domain verification, and a provider
 * that hands back the exact DNS records to paste is worth more here than one
 * fewer dependency. `fetch` is in Node 22; there is no SDK to keep in step.
 *
 * Nothing here decides *what* to say. It takes an address and a message and
 * reports what happened — the reminder job owns the wording and the timing,
 * which is what lets a second kind of reminder exist without touching this.
 */

export type SendResult =
  { ok: true; id: string } | { ok: false; reason: string };

/** Enough to send: a key, a from address, and permission. */
type MailConfig = {
  apiKey: string;
  from: string;
  adminAddress: string | null;
};

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);

  constructor(private readonly db: DbService) {}

  /**
   * What the settings row says, or null with the reason it cannot send.
   *
   * Three separate ways to be unconfigured, and they are worth telling apart:
   * somebody who has not pasted a key, somebody who has but left the switch
   * off, and somebody who has done both but not said who mail is from. "Email
   * is not set up" would send all three to the same dead end.
   */
  async config(): Promise<
    { ok: true; config: MailConfig } | { ok: false; reason: string }
  > {
    const [row] = await this.db.client
      .select({
        key: appSettings.resendApiKey,
        from: appSettings.emailFrom,
        admin: appSettings.emailAdminAddress,
        enabled: appSettings.emailEnabled,
      })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    if (!row?.key) {
      return { ok: false, reason: "No Resend key is saved in Settings." };
    }
    if (!row.enabled) {
      return { ok: false, reason: "Email is switched off in Settings." };
    }
    if (!row.from) {
      return {
        ok: false,
        reason: "No from-address is set, so mail has nobody to be from.",
      };
    }

    const apiKey = open(row.key);
    if (!apiKey) {
      // The sealed value did not open — almost always the app's encryption
      // secret changing under a key that was sealed with the old one.
      return {
        ok: false,
        reason: "The saved key could not be read. Paste it again in Settings.",
      };
    }

    return {
      ok: true,
      config: { apiKey, from: row.from, adminAddress: row.admin },
    };
  }

  /**
   * Send one message.
   *
   * Returns rather than throws. Every caller here is a scheduled job sending
   * to several people, and one bad address must not stop the rest — a thrown
   * exception on recipient two silently drops recipients three and four.
   */
  async send(
    config: MailConfig,
    to: string,
    subject: string,
    html: string,
  ): Promise<SendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: config.from, to, subject, html }),
        // A provider that has stopped answering must not hold the job open.
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          ok: false,
          reason: `${response.status} ${body.slice(0, 200)}`.trim(),
        };
      }

      const body = (await response.json()) as { id?: string };
      return { ok: true, id: body.id ?? "sent" };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error ? error.message : "Could not reach Resend",
      };
    }
  }

  /**
   * Send it once, ever.
   *
   * The guard is the unique index on `notification_log`, not a check in here —
   * a read-then-write would let two runs of the job both find nothing and both
   * send. Inserting first and letting the database refuse the duplicate is the
   * only version of this that holds when the same minute happens twice.
   */
  async sendOnce(
    config: MailConfig,
    args: {
      kind: string;
      subjectId: string;
      subjectDate: string;
      to: string;
      subject: string;
      html: string;
    },
  ): Promise<SendResult | { ok: true; id: "already-sent" }> {
    const claimed = await this.db.client
      .insert(notificationLog)
      .values({
        kind: args.kind,
        subjectId: args.subjectId,
        subjectDate: args.subjectDate,
        recipient: args.to,
        outcome: "sent",
      })
      .onConflictDoNothing()
      .returning({ id: notificationLog.id });

    if (!claimed.length) {
      // Somebody already holds this one. Not an error, and the usual case:
      // the job runs daily and only one of those days is three days out.
      return { ok: true, id: "already-sent" };
    }

    const result = await this.send(config, args.to, args.subject, args.html);

    if (!result.ok) {
      // The claim was optimistic and the send failed, so the row becomes the
      // record of a failure rather than a lie about a success — and, because
      // the unique index only covers `sent`, tomorrow's run may try again.
      await this.db.client
        .update(notificationLog)
        .set({ outcome: "failed", error: result.reason.slice(0, 500) })
        .where(eq(notificationLog.id, claimed[0].id));

      this.log.warn(`Could not mail ${args.to}: ${result.reason}`);
    }

    return result;
  }

  /** The last few, for the Settings screen to show. */
  async recent(limit = 20) {
    return this.db.client
      .select()
      .from(notificationLog)
      .orderBy(sql`${notificationLog.sentAt} desc`)
      .limit(limit);
  }

  /** Whether anything has been sent about this thing, on this date. */
  async alreadySent(kind: string, subjectId: string, subjectDate: string) {
    const [row] = await this.db.client
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.kind, kind),
          eq(notificationLog.subjectId, subjectId),
          eq(notificationLog.subjectDate, subjectDate),
          eq(notificationLog.outcome, "sent"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
