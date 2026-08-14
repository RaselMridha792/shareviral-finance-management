import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  deadlineStatus,
  formatMoney,
  tdsDepositDeadlineForMonth,
  todayInDhaka,
  withholdingReturnDeadlines,
  type AllocateDepositInput,
  type CreateTdsDepositInput,
  type FileReturnInput,
  type PendingItem,
  type PendingQuery,
  type TdsLiabilityQuery,
} from "@finance/shared";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import type { DbTransaction } from "../../db";
import {
  categories,
  payrollLines,
  payrollRuns,
  tdsAllocations,
  tdsDeposits,
  teamMembers,
  transactions,
  withholdingReturns,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { nextRefNo } from "../transactions/ref-no";

/**
 * Tax is deducted when a run is finalised, not while it is being drafted.
 *
 * `generate-lines` deletes and rebuilds a draft's lines, so a draft's tax
 * column is a work in progress — counting it would put a liability on the
 * dashboard that pressing Regenerate makes disappear.
 */
const FINALISED_OR_LATER = sql`${payrollRuns.status} <> 'draft'`;

@Injectable()
export class TdsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /*  What was deducted, what was deposited, what is still held              */
  /* ---------------------------------------------------------------------- */

  /**
   * Withheld and not yet handed to the treasury, all time, in one figure.
   *
   * Both sides must be counted the same way, and that is what went wrong
   * before this existed: the dashboard and the statement each kept their own
   * copy which summed **only** `transactions.withheld_tax_amount` — vendor tax
   * — and then subtracted **all** of `tds_deposits`, salary challans included.
   * Deducting salary tax from the deposited side while never adding it to the
   * withheld side made the figure negative, and the `max(0, …)` clamp turned
   * that into a confident `0.00`. The dashboard read "nothing owed" while the
   * TDS screen read ৳10,800 on the same data.
   *
   * Deliberately not scoped to a period: an unpaid obligation from March is
   * still owed in August, and a figure that resets every month is one nobody
   * chases.
   *
   * One method, called by both screens, so the two cannot drift again.
   */
  async outstandingAllTime(): Promise<string> {
    const [salary] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)::text`,
      })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .where(FINALISED_OR_LATER);

    const [vendor] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.direction, "out"),
          sql`${transactions.voidedAt} is null`,
        ),
      );

    const [deposited] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
      })
      .from(tdsDeposits)
      .where(
        // A challan whose ledger row was voided did not happen — the same rule
        // the monthly figures use.
        sql`not exists (
          select 1 from ${transactions}
          where ${transactions.id} = ${tdsDeposits.transactionId}
            and ${transactions.voidedAt} is not null
        )`,
      );

    const owed =
      Number(salary.total) + Number(vendor.total) - Number(deposited.total);
    return (owed > 0 ? owed : 0).toFixed(2);
  }

  /**
   * Salary tax comes from the payroll lines; vendor tax from the withheld
   * amounts on ledger rows. Deposits come from the challans. The gap is money
   * the company is holding on the treasury's behalf — the number that matters.
   */
  async liability(query: TdsLiabilityQuery) {
    const months = query.month
      ? [query.month]
      : Array.from({ length: 12 }, (_, i) => i + 1);

    const start = firstDayOf(query.year, months[0]);
    const end = lastDayOf(query.year, months[months.length - 1]);

    // Three grouped queries for the whole span, not three per month. A year
    // view was thirty-six round trips to render one screen.
    const [salary, vendor, deposited] = await Promise.all([
      this.db.client
        .select({
          month: payrollRuns.periodMonth,
          total: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)::text`,
        })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
        .where(
          and(
            eq(payrollRuns.periodYear, query.year),
            inArray(payrollRuns.periodMonth, months),
            // A draft is a working sheet: generate-lines deletes and rebuilds
            // it, and the tax figures are still being typed in. Nothing is
            // deducted until the run is finalised, so counting a draft would
            // show a liability that Regenerate can make vanish.
            FINALISED_OR_LATER,
          ),
        )
        .groupBy(payrollRuns.periodMonth),

      this.db.client
        .select({
          month: sql<number>`extract(month from ${transactions.txnDate})::int`,
          total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
        })
        .from(transactions)
        .where(
          and(
            // Only money going out. Tax a client deducts when settling our own
            // invoice is an advance-tax credit we can claim — not money we are
            // holding on the treasury's behalf. Counting it here would invent a
            // deposit obligation and have the company pay it twice over.
            eq(transactions.direction, "out"),
            gte(transactions.txnDate, start),
            lte(transactions.txnDate, end),
            sql`${transactions.voidedAt} is null`,
          ),
        )
        .groupBy(sql`1`),

      this.db.client
        .select({
          month: tdsDeposits.periodMonth,
          total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
        })
        .from(tdsDeposits)
        .where(
          and(
            eq(tdsDeposits.periodYear, query.year),
            inArray(tdsDeposits.periodMonth, months),
            // A challan whose ledger row was voided did not happen: voiding the
            // payment is how a mis-entered deposit is undone, and leaving it in
            // the total would show the tax as settled when the money came back.
            sql`not exists (
            select 1 from ${transactions}
            where ${transactions.id} = ${tdsDeposits.transactionId}
              and ${transactions.voidedAt} is not null
          )`,
          ),
        )
        .groupBy(tdsDeposits.periodMonth),
    ]);

    // A month the group-by never returned is a month with nothing in it, which
    // is what `coalesce(..., 0)` used to answer one month at a time.
    const byMonth = (rows: Array<{ month: number; total: string }>) =>
      new Map(rows.map((row) => [Number(row.month), row.total]));

    const salaryByMonth = byMonth(salary);
    const vendorByMonth = byMonth(vendor);
    const depositedByMonth = byMonth(deposited);

    const rows = months.map((month) => {
      const salaryTds = salaryByMonth.get(month) ?? "0";
      const vendorTds = vendorByMonth.get(month) ?? "0";

      const deducted = Number(salaryTds) + Number(vendorTds);
      const paid = Number(depositedByMonth.get(month) ?? "0");
      const deadline = tdsDepositDeadlineForMonth(query.year, month);

      return {
        year: query.year,
        month,
        label: deadline.periodLabel,
        salaryTds: Number(salaryTds).toFixed(2),
        vendorTds: Number(vendorTds).toFixed(2),
        totalDeducted: deducted.toFixed(2),
        deposited: paid.toFixed(2),
        outstanding: Math.max(0, deducted - paid).toFixed(2),
        /**
         * Deposited beyond what was ever withheld.
         *
         * `outstanding` is clamped at zero, and rightly — nobody owes negative
         * tax. But the clamp was the only thing said about the difference, so a
         * month where ৳18,700 was deposited against ৳6,300 withheld read
         * "outstanding ৳0" and looked settled. A challan typed with a digit too
         * many, or entered against the wrong month, is money sitting with the
         * treasury that nobody is looking for. It is the same class of mistake
         * the plan warned about for the withheld figures themselves: the app
         * does not calculate these, so a typo saves silently unless something
         * says so.
         */
        overDeposited: Math.max(0, paid - deducted).toFixed(2),
        dueOn: deadline.dueOn,
        deadlineLabel: deadline.label,
      };
    });

    // A month with a deposit but no deduction is still a month that happened,
    // and so is the reverse; only a month with neither drops out.
    const active = rows.filter(
      (row) => Number(row.totalDeducted) > 0 || Number(row.deposited) > 0,
    );

    return {
      year: query.year,
      months: active,
      totals: {
        deducted: sumOf(active.map((r) => r.totalDeducted)),
        deposited: sumOf(active.map((r) => r.deposited)),
        outstanding: sumOf(active.map((r) => r.outstanding)),
        // Summed per month, not taken from the year's two totals: a year that
        // is short in July and over in August owes July's tax and has money
        // stranded against August, and one subtraction across the year would
        // net them off and show neither.
        overDeposited: sumOf(active.map((r) => r.overDeposited)),
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Challans                                                               */
  /* ---------------------------------------------------------------------- */

  async listDeposits(year?: number) {
    const rows = await this.db.client
      .select({
        id: tdsDeposits.id,
        challanNumber: tdsDeposits.challanNumber,
        challanDate: tdsDeposits.challanDate,
        depositDate: tdsDeposits.depositDate,
        amount: tdsDeposits.amount,
        bankName: tdsDeposits.bankName,
        branch: tdsDeposits.branch,
        periodYear: tdsDeposits.periodYear,
        periodMonth: tdsDeposits.periodMonth,
        depositType: tdsDeposits.depositType,
        transactionId: tdsDeposits.transactionId,
        attachmentUrl: tdsDeposits.attachmentUrl,
        notes: tdsDeposits.notes,
        allocatedCount: sql<number>`(
          select count(*)::int from ${tdsAllocations}
          where ${tdsAllocations.depositId} = ${tdsDeposits.id}
        )`,
      })
      .from(tdsDeposits)
      .where(year ? eq(tdsDeposits.periodYear, year) : undefined)
      .orderBy(desc(tdsDeposits.depositDate), desc(tdsDeposits.createdAt));

    return {
      items: rows.map((row) => ({
        ...row,
        periodLabel: tdsDepositDeadlineForMonth(row.periodYear, row.periodMonth)
          .periodLabel,
      })),
      total: sumOf(rows.map((r) => r.amount)),
    };
  }

  async getDeposit(id: string) {
    const [deposit] = await this.db.client
      .select()
      .from(tdsDeposits)
      .where(eq(tdsDeposits.id, id))
      .limit(1);
    if (!deposit) throw new NotFoundException("No such challan");

    const allocations = await this.db.client
      .select({
        id: tdsAllocations.id,
        amount: tdsAllocations.amount,
        payrollLineId: tdsAllocations.payrollLineId,
        transactionId: tdsAllocations.transactionId,
        personName: teamMembers.fullName,
        txnRefNo: transactions.refNo,
        txnDescription: transactions.description,
      })
      .from(tdsAllocations)
      .leftJoin(payrollLines, eq(tdsAllocations.payrollLineId, payrollLines.id))
      .leftJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .leftJoin(transactions, eq(tdsAllocations.transactionId, transactions.id))
      .where(eq(tdsAllocations.depositId, id));

    const allocated = sumOf(allocations.map((a) => a.amount));

    return {
      deposit: {
        ...deposit,
        periodLabel: tdsDepositDeadlineForMonth(
          deposit.periodYear,
          deposit.periodMonth,
        ).periodLabel,
      },
      allocations,
      allocated,
      unallocated: (Number(deposit.amount) - Number(allocated)).toFixed(2),
    };
  }

  async createDeposit(input: CreateTdsDepositInput, actor: AuthenticatedUser) {
    await this.settings.assertPeriodOpen(input.depositDate);

    if (input.depositDate < input.challanDate) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          depositDate: ["The deposit cannot be dated before the challan"],
        },
      });
    }

    const [clash] = await this.db.client
      .select({ id: tdsDeposits.id })
      .from(tdsDeposits)
      .where(
        and(
          eq(tdsDeposits.challanNumber, input.challanNumber),
          eq(tdsDeposits.challanDate, input.challanDate),
        ),
      )
      .limit(1);

    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { challanNumber: ["That challan is already recorded"] },
      });
    }

    const periodLabel = tdsDepositDeadlineForMonth(
      input.periodYear,
      input.periodMonth,
    ).periodLabel;

    return this.audit.mutate({
      action: "create",
      entityTable: "tds_deposits",
      summary: `Recorded challan ${input.challanNumber} — ${formatMoney(input.amount)} of tax withheld in ${periodLabel}`,
      module: "tds",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        // The money leaving the bank is an ordinary ledger row, so the register
        // still matches the statement. The challan links to that row rather
        // than keeping a second, divergent record of the same payment.
        let transactionId: string | null = null;

        if (input.accountId) {
          const year = Number(input.depositDate.slice(0, 4));
          const categoryId = await findCategory(tx, "tds deposit");

          const [txn] = await tx
            .insert(transactions)
            .values({
              refNo: await nextRefNo(tx, year),
              accountId: input.accountId,
              direction: "out",
              txnDate: input.depositDate,
              amount: input.amount,
              categoryId,
              description: `TDS deposit — challan ${input.challanNumber} (${periodLabel})`,
              reference: input.challanNumber,
              createdVia: "tax_payment",
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning({ id: transactions.id });

          transactionId = txn.id;
        }

        const [deposit] = await tx
          .insert(tdsDeposits)
          .values({
            challanNumber: input.challanNumber,
            challanDate: input.challanDate,
            depositDate: input.depositDate,
            amount: input.amount,
            bankName: input.bankName,
            branch: input.branch,
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            depositType: input.depositType,
            accountId: input.accountId,
            attachmentUrl: input.attachmentUrl,
            notes: input.notes,
            transactionId,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning();

        return deposit;
      },
    });
  }

  /**
   * Records which deductions a challan actually covers.
   *
   * Without this, "is July's tax fully deposited?" is a manual comparison of
   * two totals. With it, an auditor asking what a given challan paid for gets
   * a list of names and reference numbers.
   */
  async allocate(
    depositId: string,
    input: AllocateDepositInput,
    actor: AuthenticatedUser,
  ) {
    const [deposit] = await this.db.client
      .select()
      .from(tdsDeposits)
      .where(eq(tdsDeposits.id, depositId))
      .limit(1);
    if (!deposit) throw new NotFoundException("No such challan");

    const lines = input.payrollLineIds.length
      ? await this.db.client
          .select({
            id: payrollLines.id,
            tdsAmount: payrollLines.tdsAmount,
            fullName: teamMembers.fullName,
          })
          .from(payrollLines)
          .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
          .where(inArray(payrollLines.id, input.payrollLineIds))
      : [];

    const txns = input.transactionIds.length
      ? await this.db.client
          .select({
            id: transactions.id,
            withheldTaxAmount: transactions.withheldTaxAmount,
            refNo: transactions.refNo,
          })
          .from(transactions)
          .where(inArray(transactions.id, input.transactionIds))
      : [];

    if (lines.length !== input.payrollLineIds.length) {
      throw new BadRequestException(
        "One of those salary lines no longer exists",
      );
    }
    if (txns.length !== input.transactionIds.length) {
      throw new BadRequestException("One of those payments no longer exists");
    }

    const zeroTax = txns.filter((t) => Number(t.withheldTaxAmount ?? 0) <= 0);
    if (zeroTax.length) {
      throw new BadRequestException(
        `No tax was withheld on ${zeroTax.map((t) => t.refNo).join(", ")}, so there is nothing to allocate.`,
      );
    }

    const total =
      lines.reduce((sum, l) => sum + Number(l.tdsAmount), 0) +
      txns.reduce((sum, t) => sum + Number(t.withheldTaxAmount ?? 0), 0);

    if (total > Number(deposit.amount) + 0.005) {
      throw new BadRequestException(
        `Those deductions come to ${formatMoney(total.toFixed(2))}, more than the challan's ${formatMoney(deposit.amount)}.`,
      );
    }

    await this.audit.mutate({
      action: "update",
      entityTable: "tds_deposits",
      entityId: depositId,
      summary: `Challan ${deposit.challanNumber} now covers ${lines.length + txns.length} deductions (${formatMoney(total.toFixed(2))})`,
      module: "tds",
      read: async (tx) => {
        const rows = await tx
          .select({
            payrollLineId: tdsAllocations.payrollLineId,
            transactionId: tdsAllocations.transactionId,
            amount: tdsAllocations.amount,
          })
          .from(tdsAllocations)
          .where(eq(tdsAllocations.depositId, depositId));
        return { allocations: rows };
      },
      run: async (tx) => {
        // Replaced wholesale: the request carries the complete intended set,
        // so unticking something has to actually remove it.
        await tx
          .delete(tdsAllocations)
          .where(eq(tdsAllocations.depositId, depositId));

        for (const line of lines) {
          await tx.insert(tdsAllocations).values({
            depositId,
            payrollLineId: line.id,
            amount: line.tdsAmount,
          });
        }
        for (const txn of txns) {
          await tx.insert(tdsAllocations).values({
            depositId,
            transactionId: txn.id,
            amount: txn.withheldTaxAmount ?? "0",
          });
        }

        await tx
          .update(tdsDeposits)
          .set({ updatedAt: new Date(), updatedBy: actor.id })
          .where(eq(tdsDeposits.id, depositId));
      },
    });

    return this.getDeposit(depositId);
  }

  /** Salary lines and vendor payments in a month that no challan covers yet. */
  async unallocated(year: number, month: number) {
    const start = firstDayOf(year, month);
    const end = lastDayOf(year, month);

    const salaryLines = await this.db.client
      .select({
        id: payrollLines.id,
        fullName: teamMembers.fullName,
        tdsAmount: payrollLines.tdsAmount,
      })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .where(
        and(
          eq(payrollRuns.periodYear, year),
          eq(payrollRuns.periodMonth, month),
          FINALISED_OR_LATER,
          sql`${payrollLines.tdsAmount} > 0`,
          sql`not exists (
            select 1 from ${tdsAllocations}
            where ${tdsAllocations.payrollLineId} = ${payrollLines.id}
          )`,
        ),
      )
      .orderBy(asc(teamMembers.fullName));

    const vendorPayments = await this.db.client
      .select({
        id: transactions.id,
        refNo: transactions.refNo,
        description: transactions.description,
        txnDate: transactions.txnDate,
        withheldTaxAmount: transactions.withheldTaxAmount,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.direction, "out"),
          gte(transactions.txnDate, start),
          lte(transactions.txnDate, end),
          sql`${transactions.withheldTaxAmount} > 0`,
          sql`${transactions.voidedAt} is null`,
          sql`not exists (
            select 1 from ${tdsAllocations}
            where ${tdsAllocations.transactionId} = ${transactions.id}
          )`,
        ),
      )
      .orderBy(asc(transactions.txnDate));

    return {
      salaryLines,
      vendorPayments,
      total: sumOf([
        ...salaryLines.map((l) => l.tdsAmount),
        ...vendorPayments.map((v) => v.withheldTaxAmount ?? "0"),
      ]),
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Quarterly withholding returns                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * The four quarterly returns for an income year.
   *
   * Any quarter with no row yet is filled in **from the statutory calendar in
   * memory**, not written to the database. A GET must not write: the CEO is
   * read-only, and a listing that inserts rows means their read creates records
   * with no actor and no audit entry. The row appears for real the moment
   * someone files it.
   */
  async listReturns(fiscalYear: number) {
    const deadlines = withholdingReturnDeadlines(fiscalYear);
    const stored = await this.fetchReturns(fiscalYear);
    const byQuarter = new Map(stored.map((row) => [row.quarter, row]));
    const today = todayInDhaka();

    return deadlines.map((deadline, index) => {
      const quarter = index + 1;
      const row = byQuarter.get(quarter);

      const base = row ?? {
        // A placeholder id the file endpoint recognises, so the button on an
        // unfiled quarter has something to post to.
        id: `unsaved:${fiscalYear}:${quarter}`,
        fiscalYear,
        quarter,
        periodStart: deadline.periodStart,
        periodEnd: deadline.periodEnd,
        dueDate: deadline.dueOn,
        filedOn: null,
        acknowledgementNo: null,
        status: "pending" as const,
        notes: null,
      };

      return {
        ...base,
        periodLabel: deadline.periodLabel,
        isOverdue: base.status === "pending" && base.dueDate < today,
      };
    });
  }

  private async findReturn(id: string) {
    const [row] = await this.db.client
      .select()
      .from(withholdingReturns)
      .where(eq(withholdingReturns.id, id))
      .limit(1);
    if (!row) throw new NotFoundException("No such return");
    return row;
  }

  /** Turns an `unsaved:2026:1` placeholder into a real row. */
  private async createReturnRow(placeholder: string) {
    const [, yearText, quarterText] = placeholder.split(":");
    const fiscalYear = Number(yearText);
    const quarter = Number(quarterText);

    const deadline = withholdingReturnDeadlines(fiscalYear)[quarter - 1];
    if (!Number.isInteger(fiscalYear) || !deadline) {
      throw new NotFoundException("No such return");
    }

    await this.db.client
      .insert(withholdingReturns)
      .values({
        fiscalYear,
        quarter,
        periodStart: deadline.periodStart,
        periodEnd: deadline.periodEnd,
        dueDate: deadline.dueOn,
      })
      .onConflictDoNothing();

    // Re-read rather than trusting the insert: another request may have won.
    const [row] = await this.db.client
      .select()
      .from(withholdingReturns)
      .where(
        and(
          eq(withholdingReturns.fiscalYear, fiscalYear),
          eq(withholdingReturns.quarter, quarter),
        ),
      )
      .limit(1);
    return row;
  }

  private fetchReturns(fiscalYear: number) {
    return this.db.client
      .select()
      .from(withholdingReturns)
      .where(eq(withholdingReturns.fiscalYear, fiscalYear))
      .orderBy(asc(withholdingReturns.quarter));
  }

  async fileReturn(
    id: string,
    input: FileReturnInput,
    actor: AuthenticatedUser,
  ) {
    // `listReturns` hands out a placeholder id for a quarter that has no row
    // yet, because listing must not write. Filing is the write, so this is
    // where the row is actually created.
    const record = id.startsWith("unsaved:")
      ? await this.createReturnRow(id)
      : await this.findReturn(id);

    if (input.filedOn < record.periodEnd) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          filedOn: [
            `The quarter runs to ${record.periodEnd}, so it cannot have been filed before then`,
          ],
        },
      });
    }

    const late = input.filedOn > record.dueDate;

    await this.audit.mutate({
      action: "update",
      entityTable: "withholding_returns",
      entityId: record.id,
      summary: `Filed the Q${record.quarter} withholding return on ${input.filedOn}${late ? ` — after the ${record.dueDate} deadline` : ""}`,
      module: "tds",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(withholdingReturns)
          .where(eq(withholdingReturns.id, record.id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(withholdingReturns)
          .set({
            filedOn: input.filedOn,
            acknowledgementNo: input.acknowledgementNo ?? null,
            notes: input.notes ?? null,
            status: late ? "late" : "filed",
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(withholdingReturns.id, record.id));
      },
    });

    return { filed: true, late };
  }

  /* ---------------------------------------------------------------------- */
  /*  The pending list                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Undeposited tax and unfiled returns, soonest first.
   *
   * This is the point of the deadline module: a figure with a date attached,
   * not a calendar of dates with no figures.
   */
  async pending(query: PendingQuery): Promise<PendingItem[]> {
    const today = todayInDhaka();
    const horizon = addDays(today, query.withinDays);
    const items: PendingItem[] = [];

    // Back a year so an old gap never quietly falls off the list, and forward
    // to the horizon so this month's deduction appears before it is late.
    const from = addDays(today, -400);
    const to = horizon;

    // Three grouped queries rather than three per month — a dashboard card
    // should not cost forty round trips.
    const [salary, vendor, deposited] = await Promise.all([
      this.db.client
        .select({
          year: payrollRuns.periodYear,
          month: payrollRuns.periodMonth,
          total: sql<string>`sum(${payrollLines.tdsAmount})::text`,
        })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
        .where(FINALISED_OR_LATER)
        .groupBy(payrollRuns.periodYear, payrollRuns.periodMonth),

      this.db.client
        .select({
          year: sql<number>`extract(year from ${transactions.txnDate})::int`,
          month: sql<number>`extract(month from ${transactions.txnDate})::int`,
          total: sql<string>`sum(${transactions.withheldTaxAmount})::text`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.direction, "out"),
            sql`${transactions.withheldTaxAmount} > 0`,
            sql`${transactions.voidedAt} is null`,
          ),
        )
        .groupBy(sql`1`, sql`2`),

      this.db.client
        .select({
          year: tdsDeposits.periodYear,
          month: tdsDeposits.periodMonth,
          total: sql<string>`sum(${tdsDeposits.amount})::text`,
        })
        .from(tdsDeposits)
        .where(
          sql`not exists (
            select 1 from ${transactions}
            where ${transactions.id} = ${tdsDeposits.transactionId}
              and ${transactions.voidedAt} is not null
          )`,
        )
        .groupBy(tdsDeposits.periodYear, tdsDeposits.periodMonth),
    ]);

    const byMonth = new Map<string, { deducted: number; paid: number }>();
    const bump = (
      year: number,
      month: number,
      field: "deducted" | "paid",
      value: string,
    ) => {
      const key = `${year}-${month}`;
      const entry = byMonth.get(key) ?? { deducted: 0, paid: 0 };
      entry[field] += Number(value);
      byMonth.set(key, entry);
    };

    for (const row of salary) bump(row.year, row.month, "deducted", row.total);
    for (const row of vendor) bump(row.year, row.month, "deducted", row.total);
    for (const row of deposited) bump(row.year, row.month, "paid", row.total);

    for (const [key, totals] of byMonth) {
      const [year, month] = key.split("-").map(Number);
      const outstanding = totals.deducted - totals.paid;
      if (outstanding <= 0.005) continue;

      const monthStart = firstDayOf(year, month);
      if (monthStart < from || monthStart > to) continue;

      const deadline = tdsDepositDeadlineForMonth(year, month);
      items.push({
        kind: "tds_deposit",
        title: `TDS for ${deadline.periodLabel}`,
        detail: `${formatMoney(outstanding.toFixed(2))} withheld but not yet deposited`,
        amount: outstanding.toFixed(2),
        dueOn: deadline.dueOn,
        status: deadlineStatus(deadline, query.withinDays, today),
        href: `/tax/withholding?year=${year}&month=${month}`,
      });
    }

    const unfiled = await this.db.client
      .select()
      .from(withholdingReturns)
      .where(
        and(
          eq(withholdingReturns.status, "pending"),
          lte(withholdingReturns.dueDate, horizon),
          lte(withholdingReturns.periodEnd, today),
        ),
      )
      .orderBy(asc(withholdingReturns.dueDate));

    for (const row of unfiled) {
      items.push({
        kind: "withholding_return",
        title: `Q${row.quarter} withholding return`,
        detail: `Covers ${row.periodStart} to ${row.periodEnd}`,
        amount: null,
        dueOn: row.dueDate,
        status: row.dueDate < today ? "overdue" : "due_soon",
        href: `/tax/withholding?fiscalYear=${row.fiscalYear}`,
      });
    }

    return items.sort((a, b) =>
      a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0,
    );
  }
}

/* -------------------------------------------------------------------------- */

/** Money strings in, one money string out. */
function sumOf(values: Array<string | null>): string {
  return values.reduce((sum, v) => sum + Number(v ?? 0), 0).toFixed(2);
}

function firstDayOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function lastDayOf(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "TDS deposit" if it is still there, otherwise the first active OUT one. */
async function findCategory(
  tx: DbTransaction,
  name: string,
): Promise<string | null> {
  const [exact] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        sql`lower(${categories.name}) = ${name}`,
        eq(categories.isActive, true),
      ),
    )
    .limit(1);
  if (exact) return exact.id;

  const [fallback] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.kind, "out"), eq(categories.isActive, true)))
    .orderBy(asc(categories.sortOrder))
    .limit(1);

  return fallback?.id ?? null;
}
