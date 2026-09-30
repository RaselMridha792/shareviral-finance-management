import { Injectable, NotFoundException } from "@nestjs/common";
import { formatMoney } from "@finance/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import {
  payrollLines,
  payrollOneOffs,
  payrollRuns,
  teamMembers,
  users,
} from "../../db/schema";
import { NotificationsService } from "../notifications/notifications.service";
import type { SubmitOneOffInput } from "./one-offs";

export type OneOffState = {
  externalId: string;
  teamMemberId: string;
  periodYear: number;
  periodMonth: number;
  amount: string;
  /** waiting: not on a sheet · on_sheet: in the bonus · paid: the sheet or line is paid. */
  state: "waiting" | "on_sheet" | "paid";
  /**
   * Finance's decision (#125): nothing goes on a sheet until it is approved.
   * The same four words GET /hr-requests/one-offs/status answers with.
   */
  decision: "pending" | "held" | "approved" | "rejected" | "withdrawn";
  /** The CFO's own words, with a hold or a refusal. */
  note: string | null;
  decidedByName: string | null;
  /** That month's sheet, or null when there is none. */
  sheetStatus: string | null;
  updatedAt: Date;
};

export type OneOffResult =
  | { outcome: "created" | "amended"; state: OneOffState }
  | {
      outcome: "conflict";
      /** Null when nothing was here before this send. */
      state: OneOffState | null;
      sheetStatus: string;
    };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The HR portal's door for one-off amounts (#121) — see `one-offs.ts` for why
 * they are not compensation. `payroll.oneoff.submit`: HR sends and reads
 * back; it does not build, change or pay a sheet.
 *
 * A send is a REQUEST (#125). It is stored and waits for the CFO or the
 * Super Admin on the HR Requests page; only an approval puts it on a sheet.
 * Keyed on the HR portal's id, a repeat amends while it waits — or while it
 * is held, which puts it back to waiting — and is answered with a 409 and
 * its state once it is decided, or once that month's sheet is finalised,
 * partly paid or paid.
 */
@Injectable()
export class PayrollOneOffsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(
    input: SubmitOneOffInput,
    actor: AuthenticatedUser,
    retried = false,
  ): Promise<OneOffResult> {
    const [member] = await this.db.client
      .select({ id: teamMembers.id, fullName: teamMembers.fullName })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.id, input.teamMemberId),
          isNull(teamMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!member) throw new NotFoundException("No such team member");

    try {
      const written = await this.db.transaction((tx) =>
        this.write(tx, input, member, actor),
      );
      if (written.outcome === "conflict") return written;
      const [state] = await this.states([input.externalId]);
      if (written.outcome === "created") {
        await this.notifications.ringHrRequest({
          kind: "one_off",
          id: written.id,
          title: `HR sent a one-off for ${member.fullName}`,
          body: `${formatMoney(input.amount, { currency: "BDT" })} on the ${MONTHS[input.periodMonth - 1]} ${input.periodYear} sheet${input.note ? ` — ${input.note}` : ""}. Waiting for a decision.`,
        });
      }
      return { outcome: written.outcome, state };
    } catch (error) {
      /* Two first sends at once: the second meets the first's row. Once
         more, and it is an amend. */
      const code =
        (error as { code?: string; cause?: { code?: string } }).code ??
        (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23505" && !retried) return this.submit(input, actor, true);
      throw error;
    }
  }

  private async write(
    tx: DbTransaction,
    input: SubmitOneOffInput,
    member: { id: string; fullName: string },
    actor: AuthenticatedUser,
  ): Promise<
    | { outcome: "created" | "amended"; id: string }
    | Extract<OneOffResult, { outcome: "conflict" }>
  > {
    const [existing] = await tx
      .select()
      .from(payrollOneOffs)
      .where(eq(payrollOneOffs.externalId, input.externalId))
      .limit(1)
      .for("update");

    /* The sheet for the month it is sent for. */
    const [target] = await tx
      .select({ status: payrollRuns.status })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodYear, input.periodYear),
          eq(payrollRuns.periodMonth, input.periodMonth),
          isNull(payrollRuns.deletedAt),
        ),
      )
      .limit(1);

    /* Decided — approved (it may be on a sheet already) or refused — or a
       month whose money is settled: answered, not changed. */
    /* Withdrawn by HR (#126) is closed too: a new request is a new id. */
    const decided =
      existing?.status === "approved" ||
      existing?.status === "refused" ||
      existing?.status === "withdrawn";
    const settled = Boolean(target?.status) && target?.status !== "draft";
    if (decided || settled) {
      const [state] = existing ? await this.states([input.externalId], tx) : [];
      return {
        outcome: "conflict",
        state: state ?? null,
        sheetStatus: target?.status ?? "none",
      };
    }

    const values = {
      teamMemberId: input.teamMemberId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: input.amount,
      note: input.note ?? null,
      /* A resend after a hold answers it: back to waiting. */
      status: "received",
      statusNote: null,
      decidedBy: null,
      decidedAt: null,
      updatedAt: new Date(),
    };
    let id: string;
    if (existing) {
      await tx
        .update(payrollOneOffs)
        .set({ ...values, sendCount: sql`${payrollOneOffs.sendCount} + 1` })
        .where(eq(payrollOneOffs.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx
        .insert(payrollOneOffs)
        .values({ externalId: input.externalId, ...values })
        .returning({ id: payrollOneOffs.id });
      id = row.id;
    }

    const month = `${MONTHS[input.periodMonth - 1]} ${input.periodYear}`;
    await this.audit.record(tx, {
      action: existing ? "update" : "create",
      entityTable: "payroll_one_offs",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: existing
        ? `${actor.fullName} changed ${member.fullName}'s one-off for the ${month} sheet to ${formatMoney(input.amount)} (was ${formatMoney(existing.amount)}) — waiting for a decision`
        : `${actor.fullName} sent a one-off of ${formatMoney(input.amount)} for ${member.fullName} on the ${month} sheet — waiting for a decision`,
      after: { externalId: input.externalId, ...values },
    });

    return { outcome: existing ? "amended" : "created", id };
  }

  /** The state of each one-off named — the ones not here are left out. */
  async states(
    externalIds: string[],
    client: DbTransaction | DbService["client"] = this.db.client,
  ): Promise<OneOffState[]> {
    if (externalIds.length === 0) return [];
    const rows = await client
      .select({
        externalId: payrollOneOffs.externalId,
        teamMemberId: payrollOneOffs.teamMemberId,
        periodYear: payrollOneOffs.periodYear,
        periodMonth: payrollOneOffs.periodMonth,
        amount: payrollOneOffs.amount,
        status: payrollOneOffs.status,
        note: payrollOneOffs.statusNote,
        decidedByName: users.fullName,
        updatedAt: payrollOneOffs.updatedAt,
        onLine: sql<boolean>`${payrollOneOffs.payrollLineId} is not null`,
        linePaid: payrollLines.isPaid,
        sheetStatus: sql<string | null>`(
          select r.status::text from ${payrollRuns} r
           where r.period_year = ${payrollOneOffs.periodYear}
             and r.period_month = ${payrollOneOffs.periodMonth}
             and r.deleted_at is null
           limit 1)`,
      })
      .from(payrollOneOffs)
      .leftJoin(payrollLines, eq(payrollLines.id, payrollOneOffs.payrollLineId))
      .leftJoin(users, eq(users.id, payrollOneOffs.decidedBy))
      .where(inArray(payrollOneOffs.externalId, externalIds));

    return rows.map(({ onLine, linePaid, status, ...row }) => ({
      ...row,
      state: !onLine
        ? "waiting"
        : linePaid || row.sheetStatus === "paid"
          ? "paid"
          : "on_sheet",
      decision:
        status === "received"
          ? "pending"
          : status === "refused"
            ? "rejected"
            : (status as "held" | "approved" | "withdrawn"),
    }));
  }
}
