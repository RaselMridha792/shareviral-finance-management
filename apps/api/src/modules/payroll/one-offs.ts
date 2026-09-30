import { amountSchema } from "@finance/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { DbTransaction } from "../../db";
import { payrollLines, payrollOneOffs } from "../../db/schema";

/**
 * One-off amounts — a bonus — sent by the HR portal for a month's salary
 * sheet (#121, settled with its session on 30 Sep 2026).
 *
 * Why its own table: the only other door, `POST /team-members/:id/
 * compensation`, closes the open salary row and opens a new one, so a bonus
 * sent through it would be the person's salary every month after. A one-off
 * lands in the sheet's bonus column instead — `payroll_lines.bonus_amount`,
 * which the generated net already adds — and nowhere else.
 *
 * It is added to the person's line on that month's sheet when the sheet is
 * built (Build list, or the person added to it), or at once if a draft sheet
 * already has them. What it added is kept (`applied_amount`), so an amend
 * moves the bonus by the difference rather than adding again. A line that
 * goes — the person taken off, the list rebuilt — sets it back to waiting
 * (the foreign key sets null), and the next build adds it again.
 */

export const submitOneOffSchema = z.strictObject({
  externalId: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amount: amountSchema.refine((value) => Number(value) > 0, {
    message: "The amount must be more than zero",
  }),
  /** Absent and null both mean no note. */
  note: z.string().trim().max(200).nullable().optional(),
});
export type SubmitOneOffInput = z.infer<typeof submitOneOffSchema>;

/**
 * Adds every waiting one-off for this sheet's month to the line of the person
 * it is for, when the sheet has one. Called inside the transaction that built
 * or changed the sheet's lines, before its totals are worked out again.
 *
 * Integer paisa throughout: the bonus is added in SQL, never in JavaScript.
 */
export async function applyPendingOneOffs(
  tx: DbTransaction,
  run: { id: string; periodYear: number; periodMonth: number },
): Promise<number> {
  const waiting = await tx
    .select({
      id: payrollOneOffs.id,
      amount: payrollOneOffs.amount,
      lineId: payrollLines.id,
    })
    .from(payrollOneOffs)
    .innerJoin(
      payrollLines,
      and(
        eq(payrollLines.teamMemberId, payrollOneOffs.teamMemberId),
        eq(payrollLines.payrollRunId, run.id),
      ),
    )
    .where(
      and(
        eq(payrollOneOffs.periodYear, run.periodYear),
        eq(payrollOneOffs.periodMonth, run.periodMonth),
        isNull(payrollOneOffs.payrollLineId),
      ),
    );
  if (waiting.length === 0) return 0;

  for (const one of waiting) {
    await tx
      .update(payrollOneOffs)
      .set({
        payrollLineId: one.lineId,
        appliedAmount: one.amount,
        updatedAt: new Date(),
      })
      .where(eq(payrollOneOffs.id, one.id));
  }

  /* One update per line, the sum of what lands on it, added in SQL. A net
     typed over the old figure is cleared, as `updateLine` clears it when the
     bonus changes: it was typed for a different sum. */
  const lineIds = [...new Set(waiting.map((one) => one.lineId))];
  await tx
    .update(payrollLines)
    .set({
      bonusAmount: sql`${payrollLines.bonusAmount} + (
        select coalesce(sum(o.applied_amount), 0) from payroll_one_offs o
         where o.payroll_line_id = ${payrollLines.id}
           and o.id in (${sql.join(
             waiting.map((one) => sql`${one.id}::uuid`),
             sql`, `,
           )}))`,
      netAmountOverride: null,
      updatedAt: new Date(),
    })
    .where(inArray(payrollLines.id, lineIds));

  return waiting.length;
}
