import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  formatMoney,
  tdsDepositDeadlineForMonth,
  deadlineStatus,
  todayInDhaka,
} from "@finance/shared";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import {
  appSettings,
  auditLogs,
  payrollLines,
  payrollRuns,
  subscriptions,
  tdsAllocations,
} from "../../db/schema";
import { NotificationsService } from "./notifications.service";
import { ALLOCATION_COUNTS } from "../tds/challan-counts";

/**
 * The four things worth interrupting somebody for.
 *
 * Every one of them is a date arriving rather than a person acting, which is
 * why they live in a job rather than in the screens that would otherwise have
 * to notice. The dates are Dhaka's: this container runs on UTC and always
 * will, and a UTC box computing "three days from today" is six hours behind —
 * which for six hours a day answers with yesterday.
 *
 * Nothing here sends mail. The renewal reminder happens to share a trigger
 * with the first of these, and sharing a trigger is not sharing a channel: a
 * bell somebody has to be at their desk to see and a message that arrives
 * wherever they are answer different questions, and switching one off should
 * not switch off the other.
 */

/** Who hears about money and tax. */
const FINANCE_ROLES = ["cfo", "super_admin"] as const;

@Injectable()
export class NotificationEventsService {
  private readonly log = new Logger(NotificationEventsService.name);

  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Ten past nine, Dhaka.
   *
   * After the renewal mail rather than alongside it. The two read the same
   * rows, and a job that starts while another is halfway through the same
   * query is a race nobody needs when ten minutes costs nothing.
   */
  @Cron("10 9 * * *", { timeZone: "Asia/Dhaka" })
  async daily() {
    const raised = await this.run();
    if (raised > 0) this.log.log(`Raised ${raised} notification(s).`);
  }

  /** The job, separated from its schedule so Settings can run it by hand. */
  async run(): Promise<number> {
    const [settings] = await this.db.client
      .select({
        renewals: appSettings.notifyRenewals,
        tds: appSettings.notifyTdsDeadline,
        payroll: appSettings.notifyPayrollUnpaid,
        changes: appSettings.notifySignificantChanges,
      })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);

    let raised = 0;
    if (settings?.renewals !== false) raised += await this.renewals();
    if (settings?.tds !== false) raised += await this.tdsDeadline();
    if (settings?.payroll !== false) raised += await this.unpaidPayroll();
    if (settings?.changes === true) raised += await this.significantChanges();
    return raised;
  }

  /* --- 1. a plan renews in three days ------------------------------------ */

  private async renewals(): Promise<number> {
    /*
     * A window, not one exact day. See the same change in the renewal
     * reminder: matching `nextRenewalOn = today + 3` exactly meant a plan
     * bought inside its own notice period was never mentioned at all, and a
     * single missed morning spent a plan's only chance in silence.
     *
     * The unique index on `notifications` keyed by the plan's own renewal date
     * is what keeps it to one, so the window can be as wide as it needs to be.
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
        renewsOn: subscriptions.nextRenewalOn,
      })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.nextRenewalOn, today),
          lte(subscriptions.nextRenewalOn, horizon),
          // A cancelled plan does not renew, and telling somebody it does is
          // how people learn to ignore the bell.
          eq(subscriptions.status, "active"),
          isNull(subscriptions.deletedAt),
        ),
      );

    if (due.length === 0) return 0;

    const userIds = await this.notifications.recipientsInRoles([
      ...FINANCE_ROLES,
    ]);

    let raised = 0;
    for (const plan of due) {
      const price = plan.costBdt
        ? formatMoney(plan.costBdt, { currency: "BDT" })
        : formatMoney(plan.costUsd, { currency: "USD" });

      raised += await this.notifications.raise({
        userIds,
        kind: "subscription_renewal",
        // Per plan per date: the same plan renewing next month is a different
        // thing to be told about.
        // The plan's own date. Keyed on the moving target, a plan would be
        // raised again on each morning of the window.
        dedupeKey: `subscription:${plan.id}:${plan.renewsOn ?? horizon}`,
        title: `${plan.toolName ?? "A plan"} renews on ${plan.renewsOn ?? horizon}`,
        body: `${plan.planName} — ${price}. There is still time to cancel or change it.`,
        href: "/subscriptions",
      });
    }
    return raised;
  }

  /* --- 2. the TDS deposit deadline --------------------------------------- */

  /**
   * Fires only when something is actually undeposited.
   *
   * A deadline notice for a month already deposited is the kind of thing that
   * teaches somebody the bell is wrong, after which the one that mattered is
   * ignored too. So the deadline decides *whether to look*, and the ledger
   * decides whether to say anything.
   *
   * Both the month just gone and the current one, because June is not like the
   * others: deductions from the 29th are due the same day, so June's deadline
   * falls inside June and a job looking only at last month would miss it
   * entirely — every year, in the one month the rules are tightest.
   */
  private async tdsDeadline(): Promise<number> {
    const today = todayInDhaka();
    const [y, m] = today.split("-").map(Number);
    const previous = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

    let raised = 0;
    for (const period of [previous, { y, m }]) {
      const deadline = tdsDepositDeadlineForMonth(period.y, period.m);
      const status = deadlineStatus(deadline, 7, today);
      if (status === "upcoming") continue;

      const outstanding = await this.undepositedTds(period.y, period.m);
      if (outstanding <= 0) continue;

      const userIds = await this.notifications.recipientsInRoles([
        ...FINANCE_ROLES,
      ]);

      raised += await this.notifications.raise({
        userIds,
        kind: "tds_deadline",
        // Per period, not per day: a deadline that raises a fresh notification
        // every morning until it is met is a deadline nobody reads.
        dedupeKey: `tds:${period.y}-${String(period.m).padStart(2, "0")}`,
        title:
          status === "overdue"
            ? `TDS for ${deadline.periodLabel} was due ${deadline.dueOn}`
            : `TDS for ${deadline.periodLabel} is due ${deadline.dueOn}`,
        body: `${formatMoney(outstanding.toFixed(2), { currency: "BDT" })} deducted and not yet deposited.${period.m === 6 ? " June runs on the same-day rule from the 29th." : ""}`,
        href: "/tax/withholding",
      });
    }
    return raised;
  }

  /**
   * Deducted on that month's payroll, less whatever a challan has covered.
   *
   * Two queries rather than one clever join. Joining the allocations onto the
   * lines and summing both columns at once multiplies each line's deduction by
   * however many allocations point at it, which for a month deposited in two
   * challans reports twice the tax the company ever withheld.
   */
  private async undepositedTds(year: number, month: number): Promise<number> {
    const lines = await this.db.client
      .select({ id: payrollLines.id, tds: payrollLines.tdsAmount })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
      .where(
        and(
          eq(payrollRuns.periodYear, year),
          eq(payrollRuns.periodMonth, month),
        ),
      );

    if (lines.length === 0) return 0;

    const deducted = lines.reduce((sum, line) => sum + Number(line.tds), 0);

    const [covered] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${tdsAllocations.amount}), 0)`,
      })
      .from(tdsAllocations)
      .where(
        and(
          inArray(
            tdsAllocations.payrollLineId,
            lines.map((line) => line.id),
          ),
          // A trashed challan covers nothing. Without this the reminder stayed
          // quiet about tax that had not been deposited at all.
          ALLOCATION_COUNTS,
        ),
      );

    return deducted - Number(covered?.total ?? 0);
  }

  /* --- 3. a month ended and its payroll is not paid ----------------------- */

  private async unpaidPayroll(): Promise<number> {
    const today = todayInDhaka();
    const [y, m] = today.split("-").map(Number);
    const period = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };

    const [run] = await this.db.client
      .select({ id: payrollRuns.id, status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodYear, period.y),
          eq(payrollRuns.periodMonth, period.m),
        ),
      )
      .orderBy(desc(payrollRuns.createdAt))
      .limit(1);

    if (run?.status === "paid") return 0;

    const userIds = await this.notifications.recipientsInRoles([
      ...FINANCE_ROLES,
    ]);

    const label = `${period.y}-${String(period.m).padStart(2, "0")}`;

    return this.notifications.raise({
      userIds,
      kind: "payroll_unpaid",
      dedupeKey: `payroll:${label}`,
      title: `${label} payroll is not paid`,
      body: run
        ? `The run exists and is ${run.status.replace("_", " ")}.`
        : "No run has been started for that month.",
      href: run ? `/payroll/${run.id}` : "/payroll",
    });
  }

  /* --- 4. somebody changed something significant -------------------------- */

  /**
   * Narrow on purpose, and narrower than it first looks.
   *
   * `audit_logs` catches every write in this app. A bell wired to all of it is
   * one nobody looks at within a week, so this takes two kinds: a voided money
   * row, and anything the audit itself already marks sensitive — which is how
   * this app records a change to somebody's pay.
   *
   * The third case the owner named, an edit inside a locked period, has
   * nothing behind it yet: there is no such thing as a locked period in this
   * schema. When there is, it belongs in the `or` below and nowhere else.
   *
   * Super admins only, and the body says what changed without repeating it —
   * a notification that quotes a salary has moved the leak the audit reader's
   * sensitivity filter exists to prevent.
   */
  private async significantChanges(): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rows = await this.db.client
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        summary: auditLogs.summary,
        sensitive: auditLogs.isSensitive,
        entityTable: auditLogs.entityTable,
        entityId: auditLogs.entityId,
      })
      .from(auditLogs)
      .where(
        and(
          gte(auditLogs.occurredAt, since),
          or(eq(auditLogs.action, "void"), eq(auditLogs.isSensitive, true)),
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(50);

    if (rows.length === 0) return 0;

    const userIds = await this.notifications.recipientsInRoles(["super_admin"]);

    let raised = 0;
    for (const row of rows) {
      raised += await this.notifications.raise({
        userIds,
        kind: "significant_change",
        // The audit row's own id. It is written once and never changes, which
        // makes it the only key here that cannot describe two different events.
        dedupeKey: `audit:${row.id}`,
        title: row.sensitive
          ? "Somebody changed a person's pay"
          : "A money row was voided",
        // The summary for a void names the entry and the amount, which is what
        // somebody needs. A sensitive row's summary can carry the figure, so
        // it is deliberately not repeated here.
        body: row.sensitive ? undefined : row.summary,
        href: "/settings",
      });
    }
    return raised;
  }

  /**
   * A date walked forward as a date.
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
}
