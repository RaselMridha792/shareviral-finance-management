import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DEFAULT_SALARY_SPLIT,
  formatMoney,
  monthlyTdsFor,
  salarySplitSchema,
  splitSalary,
  payslipBreakdownSchema,
  PAYSLIP_RUN_STATUSES,
  TDS_WARNING_RATIO,
  type CreatePayrollRunInput,
  type ListPayrollRunsQuery,
  type Paginated,
  type PayPayrollInput,
  type PayslipBreakdown,
  type SalarySplit,
  type TdsBasis,
  type TdsPolicy,
  type UpdatePayrollLineInput,
} from "@finance/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import {
  accounts,
  appSettings,
  categories,
  compensationHistory,
  payrollLines,
  payrollRuns,
  teamMembers,
  transactions,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { TaxPolicyService } from "../tds/tax-policy.service";
import { nextRefNos } from "../transactions/ref-no";

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

@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly taxPolicy: TaxPolicyService,
  ) {}

  async listRuns(
    query: ListPayrollRunsQuery,
  ): Promise<Paginated<typeof payrollRuns.$inferSelect>> {
    const filters: SQL[] = [isNull(payrollRuns.deletedAt)];
    if (query.status) filters.push(eq(payrollRuns.status, query.status));
    if (query.year) filters.push(eq(payrollRuns.periodYear, query.year));
    const where = filters.length ? and(...filters) : undefined;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select()
        .from(payrollRuns)
        .where(where)
        .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.client.select({ total: count() }).from(payrollRuns).where(where),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** A run plus its lines — the salary sheet. */
  async getRun(id: string) {
    const [run] = await this.db.client
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.id, id))
      .limit(1);

    if (!run) throw new NotFoundException("No such payroll run");

    const lines = await this.db.client
      .select({
        id: payrollLines.id,
        teamMemberId: payrollLines.teamMemberId,
        fullName: teamMembers.fullName,
        engagementType: teamMembers.engagementType,
        grossAmount: payrollLines.grossAmount,
        bonusAmount: payrollLines.bonusAmount,
        otherAdditions: payrollLines.otherAdditions,
        tdsAmount: payrollLines.tdsAmount,
        otherDeductions: payrollLines.otherDeductions,
        deductionNote: payrollLines.deductionNote,
        netAmount: payrollLines.netAmount,
        isPaid: payrollLines.isPaid,
        paidOn: payrollLines.paidOn,
        transactionId: payrollLines.transactionId,
        snapshotDesignation: payrollLines.snapshotDesignation,
        snapshotDepartment: payrollLines.snapshotDepartment,
        snapshotBankName: payrollLines.snapshotBankName,
        snapshotBankAccount: payrollLines.snapshotBankAccount,
        snapshotEtin: payrollLines.snapshotEtin,
        remarks: payrollLines.remarks,
        /*
         * The six the sheet reads and this query did not send.
         *
         * The web DTO has claimed them since the breakdown shipped, so the
         * compiler was satisfied and every one of them arrived `undefined`:
         * the Breakdown drawer opened empty on a line that had a stored
         * breakdown, and the tax working had nothing to show. Nobody had seen
         * it because both need a built sheet to reach.
         */
        earningsBreakdown: payrollLines.earningsBreakdown,
        deductionsBreakdown: payrollLines.deductionsBreakdown,
        tdsBasis: payrollLines.tdsBasis,
        tdsDeclaredInvestment: payrollLines.tdsDeclaredInvestment,
        paidDays: payrollLines.paidDays,
        workingDays: payrollLines.workingDays,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .where(eq(payrollLines.payrollRunId, id))
      .orderBy(asc(teamMembers.fullName));

    return { run, lines };
  }

  async createRun(input: CreatePayrollRunInput, actor: AuthenticatedUser) {
    const [clash] = await this.db.client
      .select({ id: payrollRuns.id })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodYear, input.periodYear),
          eq(payrollRuns.periodMonth, input.periodMonth),
        ),
      )
      .limit(1);

    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          periodMonth: ["A payroll run already exists for that month"],
        },
      });
    }

    const label = `${MONTHS[input.periodMonth - 1]} ${input.periodYear}`;

    return this.audit.mutate({
      action: "create",
      entityTable: "payroll_runs",
      summary: `Started the ${label} payroll run`,
      module: "payroll",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [row] = await tx
          .insert(payrollRuns)
          .values({
            periodYear: input.periodYear,
            periodMonth: input.periodMonth,
            label,
            notes: input.notes,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning();
        return row;
      },
    });
  }

  /**
   * Fills the sheet with everyone employed that month, at the pay they were on.
   *
   * Contractors are left out on purpose — they bill for work rather than draw
   * a monthly salary, and including them would make the run's totals and the
   * idea of a payslip both meaningless. Their payments are ordinary ledger
   * entries.
   */
  async generateLines(runId: string, actor: AuthenticatedUser) {
    const { run } = await this.getRun(runId);

    if (run.status !== "draft") {
      throw new BadRequestException(
        "This run is finalised — reopen it before regenerating the list.",
      );
    }

    const monthEnd = lastDayOf(run.periodYear, run.periodMonth);

    const employees = await this.db.client
      .select({
        id: teamMembers.id,
        fullName: teamMembers.fullName,
        designation: teamMembers.designation,
        department: teamMembers.department,
        bankName: teamMembers.bankName,
        bankAccountNumber: teamMembers.bankAccountNumber,
        etin: teamMembers.etin,
      })
      .from(teamMembers)
      .where(
        and(
          isNull(teamMembers.deletedAt),
          eq(teamMembers.engagementType, "employee"),
          // Employed at some point during the month.
          sql`${teamMembers.joinedOn} <= ${monthEnd}`,
          sql`(${teamMembers.endedOn} is null or ${teamMembers.endedOn} >= ${firstDayOf(run.periodYear, run.periodMonth)})`,
        ),
      );

    if (!employees.length) {
      throw new BadRequestException(
        "Nobody was employed in that month. Add team members first.",
      );
    }

    const withoutPay: string[] = [];
    let noTaxRule = false;

    // Read once for the whole sheet rather than per person: it is one row, and
    // the rule cannot change halfway through building a month.
    const [settingsRow] = await this.db.client
      .select({ salarySplit: appSettings.salarySplit })
      .from(appSettings)
      .limit(1);
    const parsedSplit = salarySplitSchema.safeParse(settingsRow?.salarySplit);
    const salarySplit =
      parsedSplit.success && parsedSplit.data.length
        ? parsedSplit.data
        : DEFAULT_SALARY_SPLIT;

    const created = await this.audit.mutate({
      action: "update",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Built the ${run.label} salary sheet`,
      module: "payroll",
      isSensitive: true,
      read: async (tx) => {
        const [{ n }] = await tx
          .select({ n: count() })
          .from(payrollLines)
          .where(eq(payrollLines.payrollRunId, runId));
        return { lines: Number(n) };
      },
      run: async (tx) => {
        // Rebuild from scratch so re-running picks up new joiners and raises.
        await tx
          .delete(payrollLines)
          .where(eq(payrollLines.payrollRunId, runId));

        let added = 0;
        for (const employee of employees) {
          const [pay] = await tx
            .select({
              grossAmount: compensationHistory.grossAmount,
              components: compensationHistory.components,
            })
            .from(compensationHistory)
            .where(
              and(
                eq(compensationHistory.teamMemberId, employee.id),
                sql`${compensationHistory.effectiveFrom} <= ${monthEnd}`,
              ),
            )
            .orderBy(desc(compensationHistory.effectiveFrom))
            .limit(1);

          if (!pay) {
            // No figure on record: listing them at zero would look deliberate.
            withoutPay.push(employee.fullName);
            continue;
          }

          // Worked out here rather than typed later: the sheet arrives with
          // the tax already on it, and the figure carries the rule that
          // produced it.
          const { tdsAmount, tdsBasis } = await this.computeTds(
            run.periodYear,
            run.periodMonth,
            pay.grossAmount,
            null,
          );
          if (!tdsBasis) noTaxRule = true;

          await tx.insert(payrollLines).values({
            payrollRunId: runId,
            teamMemberId: employee.id,
            grossAmount: pay.grossAmount,
            tdsAmount,
            tdsBasis,
            // Frozen here rather than read at print time: this is what the
            // split was in this month. When nobody has recorded one, the whole
            // gross becomes a single Basic Salary line — true, and what
            // somebody would have typed by hand anyway.
            earningsBreakdown: seedBreakdown(
              pay.components,
              pay.grossAmount,
              salarySplit,
            ),
            snapshotDesignation: employee.designation,
            snapshotDepartment: employee.department,
            snapshotBankName: employee.bankName,
            snapshotBankAccount: employee.bankAccountNumber,
            snapshotEtin: employee.etin,
            updatedBy: actor.id,
          });
          added++;
        }

        await this.recalculate(tx, runId);
        return added;
      },
    });

    // Both are worth saying, and neither is an error: a sheet with somebody
    // missing is still a sheet, and one with the tax unset is still payable.
    const notes = [
      withoutPay.length
        ? `${withoutPay.length} left out because no pay is recorded for them: ${withoutPay.join(", ")}`
        : null,
      noTaxRule
        ? "No tax rule is set up for that income year, so every tax figure is zero. Settings → Salary TDS has the form."
        : null,
    ].filter(Boolean);

    return {
      created,
      skipped: withoutPay,
      message: notes.length ? notes.join(" ") : undefined,
    };
  }

  async updateLine(
    lineId: string,
    input: UpdatePayrollLineInput,
    actor: AuthenticatedUser,
  ) {
    const [line] = await this.db.client
      .select({
        id: payrollLines.id,
        runId: payrollLines.payrollRunId,
        grossAmount: payrollLines.grossAmount,
        tdsAmount: payrollLines.tdsAmount,
        tdsDeclaredInvestment: payrollLines.tdsDeclaredInvestment,
        isPaid: payrollLines.isPaid,
        fullName: teamMembers.fullName,
        periodYear: payrollRuns.periodYear,
        periodMonth: payrollRuns.periodMonth,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .where(eq(payrollLines.id, lineId))
      .limit(1);

    if (!line) throw new NotFoundException("No such payroll line");
    if (line.isPaid) {
      throw new BadRequestException(
        "This person has been paid — the figures cannot change now.",
      );
    }

    // The tax is an output now, so it moves whenever either half of its sum
    // does — the gross, or what the person declared having invested.
    const recompute =
      input.grossAmount !== undefined ||
      input.tdsDeclaredInvestment !== undefined;

    const computed = recompute
      ? await this.computeTds(
          line.periodYear,
          line.periodMonth,
          input.grossAmount ?? line.grossAmount,
          input.tdsDeclaredInvestment ?? line.tdsDeclaredInvestment,
        )
      : null;

    const gross = Number(input.grossAmount ?? line.grossAmount);
    const tds = Number(computed?.tdsAmount ?? line.tdsAmount);

    await this.audit.mutate({
      action: "update",
      entityTable: "payroll_lines",
      entityId: lineId,
      summary: `Updated ${line.fullName}'s figures on the salary sheet`,
      module: "payroll",
      isSensitive: true,
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(payrollLines)
          .where(eq(payrollLines.id, lineId))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(payrollLines)
          .set({
            ...input,
            ...(computed ?? {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(payrollLines.id, lineId));
        await this.recalculate(tx, line.runId);
      },
    });

    const warning =
      gross > 0 && tds > gross * TDS_WARNING_RATIO
        ? `Tax is ${((tds / gross) * 100).toFixed(0)}% of gross — worth a second look.`
        : undefined;

    return { updated: true, warning };
  }

  /** Locks the figures. No money has moved yet. */
  async finalize(runId: string, actor: AuthenticatedUser) {
    const { run, lines } = await this.getRun(runId);

    if (run.status !== "draft") {
      throw new BadRequestException("This run is already finalised.");
    }
    if (!lines.length) {
      throw new BadRequestException("Build the salary sheet first.");
    }

    await this.audit.mutate({
      action: "finalize",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Finalised ${run.label}: ${lines.length} people, ${formatMoney(run.totalNet)} net`,
      module: "payroll",
      isSensitive: true,
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(payrollRuns)
          .where(eq(payrollRuns.id, runId))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(payrollRuns)
          .set({
            status: "finalized",
            finalizedAt: new Date(),
            finalizedBy: actor.id,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(payrollRuns.id, runId));
      },
    });

    return this.getRun(runId);
  }

  async reopen(runId: string, actor: AuthenticatedUser) {
    const { run } = await this.getRun(runId);

    /**
     * The question is whether money is still out, not what the run is called.
     *
     * This used to refuse on `status === "paid"` while telling the person to
     * "void those ledger entries first" — and doing exactly that did not help,
     * because voiding a transaction does not change the run's status. The
     * instruction was sound and the check did not implement it: somebody who
     * followed the message to the letter got the same refusal back.
     *
     * So the check now asks the ledger. Every entry voided means nothing has
     * left the bank, and reopening is safe; one live entry and it is not.
     */
    const [{ live }] = await this.db.client
      .select({ live: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.payrollRunId, runId),
          isNull(transactions.voidedAt),
        ),
      );

    if (live > 0) {
      throw new ForbiddenException(
        `Money has already gone out for this run — ${live} ledger ${live === 1 ? "entry is" : "entries are"} still live. Void ${live === 1 ? "it" : "them"} on the transaction list, then reopen.`,
      );
    }

    if (run.status !== "finalized" && run.status !== "paid") {
      throw new BadRequestException("This run is not finalised.");
    }

    await this.audit.mutate({
      action: "update",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Reopened ${run.label} for editing`,
      module: "payroll",
      read: async (tx) => {
        const [row] = await tx
          .select({ status: payrollRuns.status })
          .from(payrollRuns)
          .where(eq(payrollRuns.id, runId))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(payrollRuns)
          .set({
            status: "draft",
            finalizedAt: null,
            finalizedBy: null,
            paymentDate: null,
            accountId: null,
            updatedBy: actor.id,
          })
          .where(eq(payrollRuns.id, runId));

        /**
         * The lines have to forget the payment too.
         *
         * Reopening only moved the run's status and left every line flagged
         * `is_paid`, so the run came back as a draft that could never be paid
         * again: `pay` counts the unpaid lines, found none, and answered
         * "Everyone on this run has been paid." Correct a salary, finalise,
         * and the money simply would not go out — with no way forward from
         * the screen.
         *
         * It is safe to clear here precisely because of the guard above: the
         * run reaches this point only when no live ledger entry is left, which
         * means the payment has been taken back. Saying so on the lines is
         * recording what is already true, and the same reasoning covers the
         * run's own payment date and account.
         */
        await tx
          .update(payrollLines)
          .set({ isPaid: false, paidOn: null })
          .where(eq(payrollLines.payrollRunId, runId));
      },
    });

    return this.getRun(runId);
  }

  /**
   * Money leaves the account.
   *
   * TDS is **not** paid here — it is withheld and stays with the company until
   * the challan is deposited, which is its own ledger entry. What goes out now
   * is the net.
   */
  async pay(runId: string, input: PayPayrollInput, actor: AuthenticatedUser) {
    const { run, lines } = await this.getRun(runId);

    if (run.status === "draft") {
      throw new BadRequestException("Finalise the run before paying it.");
    }
    if (run.status === "paid") {
      throw new BadRequestException("This run has already been paid.");
    }

    await this.settings.assertPeriodOpen(input.paymentDate);

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

    const salaryCategoryId = await this.findSalaryCategory();
    const unpaid = lines.filter((line) => !line.isPaid);
    if (!unpaid.length) {
      throw new BadRequestException("Everyone on this run has been paid.");
    }

    const totalNet = unpaid
      .reduce((sum, line) => sum + Number(line.netAmount), 0)
      .toFixed(2);

    const year = Number(input.paymentDate.slice(0, 4));

    await this.audit.mutate({
      action: "pay",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Paid ${run.label}: ${formatMoney(totalNet)} to ${unpaid.length} people from ${account.name}`,
      module: "payroll",
      isSensitive: true,
      read: async (tx) => {
        const [row] = await tx
          .select({ status: payrollRuns.status })
          .from(payrollRuns)
          .where(eq(payrollRuns.id, runId))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        // One row for a consolidated payment, or one per person; reserve
        // enough either way so the whole run gets a contiguous block.
        const refs = await nextRefNos(tx, year, unpaid.length + 1);
        let issued = 0;
        const nextRef = () => refs[issued++];

        if (input.paymentMode === "consolidated") {
          // One debit, which is what most bank statements actually show.
          const [txn] = await tx
            .insert(transactions)
            .values({
              refNo: nextRef(),
              accountId: input.accountId,
              direction: "out",
              txnDate: input.paymentDate,
              amount: totalNet,
              categoryId: salaryCategoryId,
              description: `Salary — ${run.label}`,
              paymentMethod: input.paymentMethod,
              createdVia: "payroll",
              payrollRunId: runId,
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning({ id: transactions.id });

          for (const line of unpaid) {
            await tx
              .update(payrollLines)
              .set({
                isPaid: true,
                paidOn: input.paymentDate,
                transactionId: txn.id,
                updatedAt: new Date(),
                updatedBy: actor.id,
              })
              .where(eq(payrollLines.id, line.id));
          }
        } else {
          for (const line of unpaid) {
            const [txn] = await tx
              .insert(transactions)
              .values({
                refNo: nextRef(),
                accountId: input.accountId,
                direction: "out",
                txnDate: input.paymentDate,
                amount: line.netAmount,
                categoryId: salaryCategoryId,
                teamMemberId: line.teamMemberId,
                description: `Salary — ${line.fullName} — ${run.label}`,
                paymentMethod: input.paymentMethod,
                createdVia: "payroll",
                payrollRunId: runId,
                payrollLineId: line.id,
                createdBy: actor.id,
                updatedBy: actor.id,
              })
              .returning({ id: transactions.id });

            await tx
              .update(payrollLines)
              .set({
                isPaid: true,
                paidOn: input.paymentDate,
                transactionId: txn.id,
                updatedAt: new Date(),
                updatedBy: actor.id,
              })
              .where(eq(payrollLines.id, line.id));
          }
        }

        await tx
          .update(payrollRuns)
          .set({
            status: "paid",
            paymentDate: input.paymentDate,
            accountId: input.accountId,
            paymentMode: input.paymentMode,
            paymentMethod: input.paymentMethod,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(payrollRuns.id, runId));
      },
    });

    return this.getRun(runId);
  }

  /**
   * What one line's tax comes to, and everything it was worked out from.
   *
   * Always the BD income year, whatever the app's reporting mode is set to.
   * `fiscalYearMode` decides which months a report calls a quarter; it does not
   * decide when the tax year runs, and a company reporting on calendar quarters
   * still deducts against July–June.
   *
   * Returns nulls rather than throwing when no rule has been set up. A payroll
   * run must still be buildable in a year nobody has configured yet — the
   * screen says the tax is unset, which is honest, where a zero would look
   * like a decision.
   */
  private async computeTds(
    periodYear: number,
    periodMonth: number,
    grossAmount: string,
    declaredInvestment: string | null,
  ): Promise<{ tdsAmount: string; tdsBasis: TdsBasis | null }> {
    const fiscalYear = periodMonth >= 7 ? periodYear : periodYear - 1;

    let found: { policy: TdsPolicy; exact: boolean };
    try {
      found = await this.taxPolicy.forYear(fiscalYear);
    } catch {
      // No rule for the year, and none before it. Not an error here: a run has
      // to be buildable in a year nobody has configured yet.
      return { tdsAmount: "0.00", tdsBasis: null };
    }
    const { policy, exact: exactYear } = found;

    const investment = policy.rebate.assumeFullInvestment
      ? "0"
      : (declaredInvestment ?? "0");

    const { monthlyTds, annualSalary } = monthlyTdsFor(
      grossAmount,
      policy,
      investment,
    );

    return {
      tdsAmount: monthlyTds,
      tdsBasis: {
        fiscalYear,
        annualSalary,
        declaredInvestment: investment,
        exactYear,
        policy,
      },
    };
  }

  /**
   * Reapplies the year's rule to every line on a draft run.
   *
   * Wanted after the rule itself changes: rates are published late, and a sheet
   * built in July under last year's bands should not have to be rebuilt from
   * scratch — rebuilding would discard the bonuses and the breakdowns somebody
   * has typed since.
   */
  async recalculateTds(runId: string, actor: AuthenticatedUser) {
    const { run } = await this.getRun(runId);

    if (run.status !== "draft") {
      throw new BadRequestException(
        "This run is finalised — reopen it before the tax can be worked out again.",
      );
    }

    let changed = 0;
    let unset = 0;

    await this.audit.mutate({
      action: "update",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Worked out the tax again on the ${run.label} salary sheet`,
      module: "payroll",
      isSensitive: true,
      read: async (tx) => {
        const [row] = await tx
          .select({ totalTds: payrollRuns.totalTds })
          .from(payrollRuns)
          .where(eq(payrollRuns.id, runId))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const lines = await tx
          .select({
            id: payrollLines.id,
            grossAmount: payrollLines.grossAmount,
            tdsAmount: payrollLines.tdsAmount,
            declared: payrollLines.tdsDeclaredInvestment,
          })
          .from(payrollLines)
          .where(eq(payrollLines.payrollRunId, runId));

        for (const line of lines) {
          const { tdsAmount, tdsBasis } = await this.computeTds(
            run.periodYear,
            run.periodMonth,
            line.grossAmount,
            line.declared,
          );
          if (!tdsBasis) unset++;
          if (tdsAmount !== line.tdsAmount) changed++;

          await tx
            .update(payrollLines)
            .set({
              tdsAmount,
              tdsBasis,
              updatedAt: new Date(),
              updatedBy: actor.id,
            })
            .where(eq(payrollLines.id, line.id));
        }

        await this.recalculate(tx, runId);
        return lines.length;
      },
    });

    return {
      changed,
      message: unset
        ? `No tax rule is set up for that year, so ${unset} of the figures are zero. Settings → Salary TDS has the form.`
        : `${changed} ${changed === 1 ? "figure" : "figures"} changed.`,
    };
  }

  /** One person's payslip. */
  async payslip(lineId: string) {
    const [line] = await this.db.client
      .select({
        id: payrollLines.id,
        grossAmount: payrollLines.grossAmount,
        bonusAmount: payrollLines.bonusAmount,
        otherAdditions: payrollLines.otherAdditions,
        tdsAmount: payrollLines.tdsAmount,
        otherDeductions: payrollLines.otherDeductions,
        deductionNote: payrollLines.deductionNote,
        netAmount: payrollLines.netAmount,
        isPaid: payrollLines.isPaid,
        paidOn: payrollLines.paidOn,
        snapshotDesignation: payrollLines.snapshotDesignation,
        snapshotDepartment: payrollLines.snapshotDepartment,
        snapshotBankName: payrollLines.snapshotBankName,
        snapshotBankAccount: payrollLines.snapshotBankAccount,
        snapshotEtin: payrollLines.snapshotEtin,
        earningsBreakdown: payrollLines.earningsBreakdown,
        deductionsBreakdown: payrollLines.deductionsBreakdown,
        paidDays: payrollLines.paidDays,
        workingDays: payrollLines.workingDays,
        remarks: payrollLines.remarks,
        fullName: teamMembers.fullName,
        // Live, not snapshot. A staff code and a joining date are facts about
        // the person that do not change with the month — unlike the bank
        // account above them, which does, and is therefore frozen.
        employeeCode: teamMembers.employeeCode,
        joinedOn: teamMembers.joinedOn,
        engagementType: teamMembers.engagementType,
        runId: payrollRuns.id,
        runLabel: payrollRuns.label,
        runStatus: payrollRuns.status,
        periodYear: payrollRuns.periodYear,
        periodMonth: payrollRuns.periodMonth,
        paymentDate: payrollRuns.paymentDate,
        paymentMethod: payrollRuns.paymentMethod,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .where(eq(payrollLines.id, lineId))
      .limit(1);

    if (!line) throw new NotFoundException("No such payslip");
    return line;
  }

  /**
   * One person's payslips — the same rows, asked from the other end.
   *
   * Until now a payslip could only be reached by remembering which month it
   * was in, opening that run and finding the line. "Show me this person's
   * payslips" is the question a profile page exists to answer, and it is the
   * question somebody asks when an employee needs three months of slips for a
   * visa or a loan.
   *
   * Deliberately narrow: the month, the three figures a payslip is judged on,
   * and the line id the existing payslip route takes. Everything else — the
   * bank account, the e-TIN, the snapshots — is on the payslip itself, and a
   * list is not the place to repeat it.
   */
  async memberPayslips(teamMemberId: string) {
    return this.db.client
      .select({
        id: payrollLines.id,
        runId: payrollRuns.id,
        runLabel: payrollRuns.label,
        runStatus: payrollRuns.status,
        periodYear: payrollRuns.periodYear,
        periodMonth: payrollRuns.periodMonth,
        grossAmount: payrollLines.grossAmount,
        tdsAmount: payrollLines.tdsAmount,
        netAmount: payrollLines.netAmount,
        isPaid: payrollLines.isPaid,
        paidOn: payrollLines.paidOn,
      })
      .from(payrollLines)
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .where(
        and(
          eq(payrollLines.teamMemberId, teamMemberId),
          // Drafts are excluded rather than shown greyed out: the figures on
          // one are still being typed, and a payslip nobody may rely on is
          // worse than no payslip at all.
          inArray(payrollRuns.status, [...PAYSLIP_RUN_STATUSES]),
        ),
      )
      .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth));
  }

  /** Recomputes a run's totals from its lines. */
  private async recalculate(tx: DbTransaction, runId: string) {
    const [totals] = await tx
      .select({
        gross: sql<string>`coalesce(sum(${payrollLines.grossAmount}), 0)::text`,
        additions: sql<string>`coalesce(sum(${payrollLines.bonusAmount} + ${payrollLines.otherAdditions}), 0)::text`,
        tds: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)::text`,
        deductions: sql<string>`coalesce(sum(${payrollLines.otherDeductions}), 0)::text`,
        net: sql<string>`coalesce(sum(${payrollLines.netAmount}), 0)::text`,
      })
      .from(payrollLines)
      .where(eq(payrollLines.payrollRunId, runId));

    await tx
      .update(payrollRuns)
      .set({
        totalGross: totals.gross,
        totalAdditions: totals.additions,
        totalTds: totals.tds,
        totalDeductions: totals.deductions,
        totalNet: totals.net,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, runId));
  }

  /** The category salary payments are filed under. */
  private async findSalaryCategory(): Promise<string> {
    const [salary] = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          sql`lower(${categories.name}) = 'salary'`,
          eq(categories.isActive, true),
          isNull(categories.deletedAt),
        ),
      )
      .limit(1);

    if (salary) return salary.id;

    /*
     * The fallback files salary under whichever OUT category sorts first,
     * which is a guess — and a guess must not land on something somebody
     * deleted. A deleted heading still satisfied `isActive`, so without this
     * line payroll could post a month's salary into the trash.
     */
    const [fallback] = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.kind, "out"),
          eq(categories.isActive, true),
          isNull(categories.deletedAt),
        ),
      )
      .orderBy(asc(categories.sortOrder))
      .limit(1);

    if (!fallback) {
      throw new BadRequestException(
        "There is no money-out category to file salary under. Add one in Settings.",
      );
    }
    return fallback.id;
  }
}

function firstDayOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * The earnings table a freshly built line starts with.
 *
 * `compensation_history.components` is free-form jsonb, so it is read
 * defensively: anything that is not a list of `{label, amount}` counts as
 * nothing recorded. A payslip printing a malformed component as
 * "[object Object]  0.00" would be worse than one printing a single line.
 */
function seedBreakdown(
  components: unknown,
  grossAmount: string,
  split: SalarySplit,
): PayslipBreakdown {
  const parsed = payslipBreakdownSchema.safeParse(components);
  if (parsed.success && parsed.data.length > 0) return parsed.data;

  /**
   * No split on record, so the company's rule is applied instead.
   *
   * The alternative was one "Basic Salary" line for the whole gross, which is
   * what this did before the rule existed — and it would have left every person
   * hired before it printing a payslip with no breakdown at all, for no reason
   * a reader could see. Their next raise writes a real split; until then this
   * is the same arithmetic, done at build time rather than at hire time.
   */
  const derived = splitSalary(grossAmount, split);
  return derived.length
    ? derived
    : [{ label: "Basic Salary", amount: grossAmount }];
}

function lastDayOf(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}
