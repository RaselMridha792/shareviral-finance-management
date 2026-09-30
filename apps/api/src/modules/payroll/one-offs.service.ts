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
} from "../../db/schema";
import { applyPendingOneOffs, type SubmitOneOffInput } from "./one-offs";
import { PayrollService } from "./payroll.service";

export type OneOffState = {
  externalId: string;
  teamMemberId: string;
  periodYear: number;
  periodMonth: number;
  amount: string;
  /** waiting: no line for it yet · on_sheet: in the bonus · paid: the sheet or line is paid. */
  state: "waiting" | "on_sheet" | "paid";
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
 * A send is keyed on the HR portal's id. It amends while the sheet it sits on
 * (or is bound for) is still a draft — the old amount taken back off the
 * line, the new one put on — and is refused with a 409 once that month's
 * sheet is finalised, partly paid or paid: the money on it is settled, and
 * HR picks another month.
 */
@Injectable()
export class PayrollOneOffsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
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
    | { outcome: "created" | "amended" }
    | Extract<OneOffResult, { outcome: "conflict" }>
  > {
    const [existing] = await tx
      .select()
      .from(payrollOneOffs)
      .where(eq(payrollOneOffs.externalId, input.externalId))
      .limit(1)
      .for("update");

    /* The sheet it is on now, if it has been put on one. */
    const [current] = existing?.payrollLineId
      ? await tx
          .select({
            runId: payrollRuns.id,
            status: payrollRuns.status,
            isPaid: payrollLines.isPaid,
          })
          .from(payrollLines)
          .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
          .where(eq(payrollLines.id, existing.payrollLineId))
          .limit(1)
      : [];

    /* The sheet for the month it is sent for. */
    const [target] = await tx
      .select({
        id: payrollRuns.id,
        status: payrollRuns.status,
        periodYear: payrollRuns.periodYear,
        periodMonth: payrollRuns.periodMonth,
      })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodYear, input.periodYear),
          eq(payrollRuns.periodMonth, input.periodMonth),
          isNull(payrollRuns.deletedAt),
        ),
      )
      .limit(1);

    const settled = (status: string | undefined) =>
      Boolean(status) && status !== "draft";
    if (
      settled(current?.status) ||
      current?.isPaid ||
      settled(target?.status)
    ) {
      const [state] = existing ? await this.states([input.externalId], tx) : [];
      return {
        outcome: "conflict",
        state: state ?? null,
        sheetStatus:
          (settled(current?.status) ? current?.status : target?.status) ??
          "paid",
      };
    }

    const touched = new Set<string>();

    /* Take the old amount back off the line it was on. */
    if (existing?.payrollLineId && existing.appliedAmount && current) {
      await tx
        .update(payrollLines)
        .set({
          /* Never below zero: finance may have lowered the bonus by
             hand after this was added. */
          bonusAmount: sql`greatest(${payrollLines.bonusAmount} - ${existing.appliedAmount}::numeric, 0)`,
          netAmountOverride: null,
          updatedAt: new Date(),
        })
        .where(eq(payrollLines.id, existing.payrollLineId));
      touched.add(current.runId);
    }

    const values = {
      teamMemberId: input.teamMemberId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      amount: input.amount,
      note: input.note ?? null,
      payrollLineId: null,
      appliedAmount: null,
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

    /* Onto this month's sheet at once, if it is a draft with them on it. */
    if (target) {
      await applyPendingOneOffs(tx, target);
      touched.add(target.id);
    }
    for (const runId of touched)
      await this.payroll.recalculateTotals(tx, runId);

    const month = `${MONTHS[input.periodMonth - 1]} ${input.periodYear}`;
    await this.audit.record(tx, {
      action: existing ? "update" : "create",
      entityTable: "payroll_one_offs",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: existing
        ? `${actor.fullName} changed ${member.fullName}'s one-off for the ${month} sheet to ${formatMoney(input.amount)} (was ${formatMoney(existing.amount)})`
        : `${actor.fullName} sent a one-off of ${formatMoney(input.amount)} for ${member.fullName} on the ${month} sheet`,
      after: { externalId: input.externalId, ...values },
    });

    return { outcome: existing ? "amended" : "created" };
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
      .where(inArray(payrollOneOffs.externalId, externalIds));

    return rows.map(({ onLine, linePaid, ...row }) => ({
      ...row,
      state: !onLine
        ? "waiting"
        : linePaid || row.sheetStatus === "paid"
          ? "paid"
          : "on_sheet",
    }));
  }
}
