import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  advanceTaxDeadlines,
  formatMoney,
  incomeTaxReturnDeadline,
  todayInDhaka,
  type PayIncomeTaxInput,
  type PendingItem,
  type PendingQuery,
  type UpdateIncomeTaxInput,
} from "@finance/shared";
import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  accounts,
  categories,
  incomeTaxRecords,
  transactions,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { nextRefNo } from "../transactions/ref-no";

@Injectable()
export class IncomeTaxService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The four advance instalments plus the annual return for an income year.
   *
   * The dates are statutory defaults, not facts: NBR extends Tax Day by order
   * most years, so every due date stays editable afterwards.
   */
  async schedule(fiscalYear: number, actor: AuthenticatedUser) {
    const assessmentYear = assessmentYearFor(fiscalYear);
    const advance = advanceTaxDeadlines(fiscalYear);
    const annual = incomeTaxReturnDeadline(fiscalYear);

    const existing = await this.fetch(assessmentYear);
    const haveQuarter = new Set(
      existing
        .filter((r) => r.recordType === "advance_quarter")
        .map((r) => r.quarter),
    );
    const haveAnnual = existing.some((r) => r.recordType === "final_return");

    // Fill in what is missing rather than all-or-nothing. A year that was
    // half-created — by an interrupted run, or by importing last year's
    // figures — would otherwise never get its remaining instalments.
    const wanted = advance
      .map((deadline, index) => ({ deadline, quarter: index + 1 }))
      .filter(({ quarter }) => !haveQuarter.has(quarter));

    if (!wanted.length && haveAnnual) return this.decorate(existing);

    await this.audit.mutate({
      action: "create",
      entityTable: "income_tax_records",
      summary:
        `Opened the ${assessmentYear} tax schedule — ` +
        [
          wanted.length
            ? `${wanted.length} advance instalment${wanted.length === 1 ? "" : "s"}`
            : null,
          haveAnnual ? null : "the annual return",
        ]
          .filter(Boolean)
          .join(" and "),
      module: "income-tax",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const created: Array<typeof incomeTaxRecords.$inferSelect> = [];

        for (const { deadline, quarter } of wanted) {
          const [row] = await tx
            .insert(incomeTaxRecords)
            .values({
              assessmentYear,
              incomeYearStart: deadline.periodStart,
              incomeYearEnd: deadline.periodEnd,
              recordType: "advance_quarter",
              quarter,
              dueDate: deadline.dueOn,
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning();
          created.push(row);
        }

        if (!haveAnnual) {
          const [row] = await tx
            .insert(incomeTaxRecords)
            .values({
              assessmentYear,
              incomeYearStart: annual.periodStart,
              incomeYearEnd: annual.periodEnd,
              recordType: "final_return",
              dueDate: annual.dueOn,
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning();
          created.push(row);
        }

        return created;
      },
    });

    return this.decorate(await this.fetch(assessmentYear));
  }

  async list(assessmentYear?: string) {
    const rows = assessmentYear
      ? await this.fetch(assessmentYear)
      : await this.db.client
          .select()
          .from(incomeTaxRecords)
          .orderBy(
            desc(incomeTaxRecords.assessmentYear),
            asc(incomeTaxRecords.dueDate),
          );

    return this.decorate(rows);
  }

  async get(id: string) {
    const record = await this.find(id);
    const [decorated] = this.decorate([record]).items;
    return decorated;
  }

  async update(
    id: string,
    input: UpdateIncomeTaxInput,
    actor: AuthenticatedUser,
  ) {
    const record = await this.find(id);

    if (
      input.amountPayable !== undefined &&
      Number(input.amountPayable) < Number(record.amountPaid)
    ) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          amountPayable: [
            `${formatMoney(record.amountPaid)} has already been paid against this, so the amount cannot be lower`,
          ],
        },
      });
    }

    await this.audit.mutate({
      action: "update",
      entityTable: "income_tax_records",
      entityId: id,
      summary: `Updated the ${record.assessmentYear} ${describe(record)}`,
      module: "income-tax",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(incomeTaxRecords)
          .where(eq(incomeTaxRecords.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        // Re-read under a row lock: the figure that decides the status must be
        // the one in the database now, not the one from before the validation
        // round trips above.
        const [live] = await tx
          .select()
          .from(incomeTaxRecords)
          .where(eq(incomeTaxRecords.id, id))
          .for("update")
          .limit(1);

        const payable =
          input.amountPayable !== undefined
            ? Number(input.amountPayable)
            : Number(live.amountPayable);
        const paid = Number(live.amountPaid);
        const submittedOn = input.returnSubmittedOn ?? live.returnSubmittedOn;

        await tx
          .update(incomeTaxRecords)
          .set({
            ...input,
            status: statusFor({
              recordType: live.recordType,
              payable,
              paid,
              submittedOn,
            }),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(incomeTaxRecords.id, id));
      },
    });

    return this.get(id);
  }

  /**
   * Records a payment against an instalment or the final return, and writes
   * the matching money-out row to the ledger in the same transaction.
   */
  async pay(id: string, input: PayIncomeTaxInput, actor: AuthenticatedUser) {
    const record = await this.find(id);
    await this.settings.assertPeriodOpen(input.paidOn);

    if (input.paidOn < input.challanDate) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { paidOn: ["The payment cannot predate the challan"] },
      });
    }

    const [account] = await this.db.client
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .limit(1);
    if (!account) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { accountId: ["No such account"] },
      });
    }

    const [clash] = await this.db.client
      .select({ id: incomeTaxRecords.id })
      .from(incomeTaxRecords)
      .where(
        and(
          eq(incomeTaxRecords.challanNumber, input.challanNumber),
          eq(incomeTaxRecords.challanDate, input.challanDate),
          ne(incomeTaxRecords.id, id),
        ),
      )
      .limit(1);
    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          challanNumber: [
            "That challan is already recorded against another instalment",
          ],
        },
      });
    }

    await this.audit.mutate({
      action: "pay",
      entityTable: "income_tax_records",
      entityId: id,
      summary: `Paid ${formatMoney(input.amount)} of ${record.assessmentYear} company tax from ${account.name}, challan ${input.challanNumber}`,
      module: "income-tax",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(incomeTaxRecords)
          .where(eq(incomeTaxRecords.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        // Lock the row before reading the running total. Without this, two
        // payments submitted at the same time both read the old amountPaid and
        // the second overwrites the first — two ledger rows, one recorded
        // payment, and a permanent disagreement between the two.
        const [live] = await tx
          .select()
          .from(incomeTaxRecords)
          .where(eq(incomeTaxRecords.id, id))
          .for("update")
          .limit(1);

        const paidNow = Number(live.amountPaid) + Number(input.amount);
        const payable = Number(live.amountPayable);

        const year = Number(input.paidOn.slice(0, 4));
        const wanted =
          record.recordType === "advance_quarter"
            ? "advance tax"
            : "income tax";
        const [category] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              sql`lower(${categories.name}) = ${wanted}`,
              eq(categories.isActive, true),
            ),
          )
          .limit(1);

        const [txn] = await tx
          .insert(transactions)
          .values({
            refNo: await nextRefNo(tx, year),
            accountId: input.accountId,
            direction: "out",
            txnDate: input.paidOn,
            amount: input.amount,
            categoryId: category?.id ?? null,
            description: `${describe(record)} — ${record.assessmentYear}, challan ${input.challanNumber}`,
            reference: input.challanNumber,
            createdVia: "tax_payment",
            taxPaymentId: id,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: transactions.id });

        await tx
          .update(incomeTaxRecords)
          .set({
            amountPaid: paidNow.toFixed(2),
            paidOn: input.paidOn,
            challanNumber: input.challanNumber,
            challanDate: input.challanDate,
            accountId: input.accountId,
            transactionId: txn.id,
            status: statusFor({
              recordType: live.recordType,
              payable,
              paid: paidNow,
              submittedOn: live.returnSubmittedOn,
            }),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(incomeTaxRecords.id, id));
      },
    });

    return this.get(id);
  }

  /** Instalments and returns coming due, for the dashboard's pending card. */
  async pending(query: PendingQuery): Promise<PendingItem[]> {
    const today = todayInDhaka();
    const horizon = addDays(today, query.withinDays);

    const rows = await this.db.client
      .select()
      .from(incomeTaxRecords)
      .where(
        and(
          sql`${incomeTaxRecords.status} in ('pending', 'partially_paid')`,
          lte(incomeTaxRecords.dueDate, horizon),
        ),
      )
      .orderBy(asc(incomeTaxRecords.dueDate));

    return rows.map((row) => {
      const due = (Number(row.amountPayable) - Number(row.amountPaid)).toFixed(
        2,
      );

      return {
        kind:
          row.recordType === "advance_quarter"
            ? ("advance_tax" as const)
            : ("income_tax_return" as const),
        title:
          row.recordType === "advance_quarter"
            ? `Advance tax instalment ${row.quarter}`
            : `Company tax return ${row.assessmentYear}`,
        detail:
          Number(row.amountPayable) > 0
            ? `${formatMoney(due)} still to pay`
            : "Amount not yet assessed",
        amount: Number(row.amountPayable) > 0 ? due : null,
        dueOn: row.dueDate,
        status:
          row.dueDate < today ? ("overdue" as const) : ("due_soon" as const),
        href: "/tax/income-tax",
      };
    });
  }

  private fetch(assessmentYear: string) {
    return this.db.client
      .select()
      .from(incomeTaxRecords)
      .where(eq(incomeTaxRecords.assessmentYear, assessmentYear))
      .orderBy(asc(incomeTaxRecords.dueDate));
  }

  private async find(id: string) {
    const [row] = await this.db.client
      .select()
      .from(incomeTaxRecords)
      .where(eq(incomeTaxRecords.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("No such tax record");
    return row;
  }

  private decorate(rows: Array<typeof incomeTaxRecords.$inferSelect>) {
    const today = todayInDhaka();

    return {
      items: rows.map((row) => ({
        ...row,
        label: describe(row),
        outstanding: (
          Number(row.amountPayable) - Number(row.amountPaid)
        ).toFixed(2),
        isOverdue: row.status !== "paid" && row.dueDate < today,
      })),
      totals: {
        payable: rows
          .reduce((s, r) => s + Number(r.amountPayable), 0)
          .toFixed(2),
        paid: rows.reduce((s, r) => s + Number(r.amountPaid), 0).toFixed(2),
        outstanding: rows
          .reduce(
            (s, r) =>
              s + Math.max(0, Number(r.amountPayable) - Number(r.amountPaid)),
            0,
          )
          .toFixed(2),
      },
    };
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The one place a tax record's status is decided.
 *
 * `filed` outranks `paid`: an annual return that has been submitted to NBR is
 * done, whatever the arithmetic says. Without this the status could never
 * reach `filed` at all, and a submitted return went on showing as "Overdue"
 * past its due date for ever.
 */
function statusFor(input: {
  recordType: string;
  payable: number;
  paid: number;
  submittedOn: string | null;
}): "pending" | "partially_paid" | "paid" | "filed" {
  if (input.recordType === "final_return" && input.submittedOn) return "filed";
  if (input.paid <= 0.005) return "pending";
  if (input.payable > 0 && input.paid + 0.005 >= input.payable) return "paid";
  return "partially_paid";
}

/** 2026 means the income year Jul 2026–Jun 2027, assessed in 2027-2028. */
function assessmentYearFor(fiscalYear: number): string {
  return `${fiscalYear + 1}-${fiscalYear + 2}`;
}

function describe(row: { recordType: string; quarter: number | null }): string {
  switch (row.recordType) {
    case "advance_quarter":
      return `Advance tax instalment ${row.quarter ?? ""}`.trim();
    case "final_return":
      return "Annual return";
    case "adjustment":
      return "Adjustment";
    default:
      return "Penalty";
  }
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
