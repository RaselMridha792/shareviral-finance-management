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
  type SetRunFxRateInput,
  type TdsBasis,
  type TdsPolicy,
  type UpdatePayrollLineInput,
  type SyncRunMembersInput,
} from "@finance/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { overdraftWatch } from "../../common/money/overdraft";
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

  /**
   * How many documents of these kinds are on a run.
   *
   * A count and not a boolean, because the table draws an eye only where the
   * drawer behind it has something in it. Two separate counts and not one
   * total, for the reason the transactions table learned the hard way: a row
   * with only an invoice would otherwise offer an eye on Reference too, and a
   * click into an empty drawer is the complaint this pattern exists to avoid.
   *
   * `payroll_runs.id` is written out rather than interpolated as
   * `${payrollRuns.id}`, and that is not a style choice. Drizzle renders a
   * column inside a `sql` template UNQUALIFIED — as `"id"` — and `files` has
   * an `id` of its own, so inside this subquery the correlation silently
   * became `df.payroll_run_id = df.id`. It compiles, it runs, it raises
   * nothing, and every count comes back 0: the table drew N/A on a run whose
   * invoice was sitting right there in the database.
   */
  private static documentCountOf(kinds: readonly string[]) {
    return sql<number>`(
      select count(*)::int
        from files df
       where df.payroll_run_id = payroll_runs.id
         and df.deleted_at is null
         and df.kind in (${sql.join(
           kinds.map((k) => sql`${k}`),
           sql`, `,
         )}))`;
  }

  async listRuns(query: ListPayrollRunsQuery): Promise<
    Paginated<
      typeof payrollRuns.$inferSelect & {
        invoiceCount: number;
        recordCount: number;
      }
    >
  > {
    const filters: SQL[] = [isNull(payrollRuns.deletedAt)];
    if (query.status) filters.push(eq(payrollRuns.status, query.status));
    if (query.year) filters.push(eq(payrollRuns.periodYear, query.year));
    const where = filters.length ? and(...filters) : undefined;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        /*
         * Spread rather than a written-out list. Naming the columns by hand is
         * how this codebase has three times shipped a screen missing a field
         * that was added to the schema and never to the projection; spreading
         * makes a new column arrive on its own.
         */
        .select({
          ...getTableColumns(payrollRuns),
          invoiceCount: PayrollService.documentCountOf(["invoice"]),
          recordCount: PayrollService.documentCountOf([
            "bank_statement",
            "receipt",
            "other",
          ]),
        })
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
        // In the projection as well as in the schema. A column that reaches
        // one and not the other is how this app has three times shipped a
        // field that stored correctly and read back N/A.
        tdsManual: payrollLines.tdsManual,
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
        /*
         * In the projection as well as the schema, which is the step this
         * codebase has forgotten three times — on accounts, on team members
         * and on vendors. The column stores perfectly and the screen reads
         * undefined, so a figure somebody typed comes back as N/A and looks
         * like a save that silently failed.
         */
        fxRate: payrollLines.fxRate,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .where(eq(payrollLines.payrollRunId, id))
      // Seniority, as the directory shows it — the sheet, its Excel and
      // every payslip trace to this one order.
      .orderBy(
        asc(teamMembers.joinedOn),
        asc(teamMembers.fullName),
        asc(teamMembers.id),
      );

    return { run, lines };
  }

  async createRun(input: CreatePayrollRunInput, actor: AuthenticatedUser) {
    const label = `${MONTHS[input.periodMonth - 1]} ${input.periodYear}`;

    const [clash] = await this.db.client
      .select({ id: payrollRuns.id, deletedAt: payrollRuns.deletedAt })
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.periodYear, input.periodYear),
          eq(payrollRuns.periodMonth, input.periodMonth),
        ),
      )
      .limit(1);

    /*
     * A month is unique whether its run is live or in the trash — the database
     * says so, and it should: two August sheets, one deleted and one not, is a
     * question with two answers. What the reader needs is which of the two
     * situations they are in, because the way out is different. "Already
     * exists" about a run they had just deleted read as a lie, and the screen
     * only ever showed the generic half of it.
     */
    if (clash?.deletedAt) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          periodMonth: [
            `The ${label} run is in the trash. Restore it from Settings → Trashed, or delete it there permanently, and then start the month again.`,
          ],
        },
      });
    }
    if (clash) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          periodMonth: [`A payroll run for ${label} already exists`],
        },
      });
    }

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

    const salarySplit = await this.readSalarySplit();

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
          const built = await this.buildLine(
            tx,
            run,
            employee,
            salarySplit,
            actor.id,
          );
          if (built === "no-pay") {
            // No figure on record: listing them at zero would look deliberate.
            withoutPay.push(employee.fullName);
            continue;
          }
          if (built === "added-without-tax-rule") noTaxRule = true;
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

  /**
   * One rate typed once, written onto every line of the sheet.
   *
   * The owner: *"dollar rate prottek sarite thakuk tarporeo opore ek jaygay
   * rakho jekhane rakhle table er sobgula field a auto fill hobe caile edit o
   * korte parbe."*
   *
   * A fill, not a second home for the figure. The rate still lives in each
   * line's own `fx_rate` and each line stays editable afterwards; this only
   * saves typing it once per person. Lines that already state a rate are left
   * alone unless `overwrite` says otherwise, so filling the column cannot
   * quietly undo something somebody typed.
   *
   * The same two locks `updateLine` has, for the same reasons: a finalised
   * sheet is finalised on the server too, and a person already paid keeps the
   * figures they were paid on. Those are checked here rather than borrowed,
   * because this writes without going through that method.
   */
  async setRunFxRate(
    runId: string,
    input: SetRunFxRateInput,
    actor: AuthenticatedUser,
  ) {
    const [run] = await this.db.client
      .select({
        id: payrollRuns.id,
        label: payrollRuns.label,
        status: payrollRuns.status,
      })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.id, runId), isNull(payrollRuns.deletedAt)))
      .limit(1);

    if (!run) throw new NotFoundException("No such payroll run");
    if (run.status !== "draft") {
      throw new BadRequestException(
        "That sheet has been finalised — reopen it before changing a figure.",
      );
    }

    return this.audit.mutate({
      action: "update",
      entityTable: "payroll_runs",
      entityId: runId,
      summary: `Set the USD rate to ${input.fxRate} across ${run.label}`,
      module: "payroll",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const updated = await tx
          .update(payrollLines)
          .set({
            fxRate: input.fxRate,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(
            and(
              eq(payrollLines.payrollRunId, runId),
              /* Paid people keep the figures they were paid on. */
              eq(payrollLines.isPaid, false),
              ...(input.overwrite ? [] : [isNull(payrollLines.fxRate)]),
            ),
          )
          .returning({ id: payrollLines.id });

        return { filled: updated.length, fxRate: input.fxRate };
      },
    });
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
        teamMemberId: payrollLines.teamMemberId,
        grossAmount: payrollLines.grossAmount,
        tdsAmount: payrollLines.tdsAmount,
        tdsManual: payrollLines.tdsManual,
        tdsDeclaredInvestment: payrollLines.tdsDeclaredInvestment,
        isPaid: payrollLines.isPaid,
        fullName: teamMembers.fullName,
        periodYear: payrollRuns.periodYear,
        periodMonth: payrollRuns.periodMonth,
        runStatus: payrollRuns.status,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
      .where(eq(payrollLines.id, lineId))
      .limit(1);

    if (!line) throw new NotFoundException("No such payroll line");

    /*
     * A finalised sheet is finalised on the server too.
     *
     * `finalize` is documented as "Locks the figures", the screen stops drawing
     * editable cells the moment a run leaves draft, and `generateLines`,
     * `syncMembers` and `recalculateTds` all refuse a non-draft run. This one
     * checked only whether the PERSON had been paid — so every figure on a
     * finalised, unpaid sheet was still writable through the API, and the lock
     * was a thing the screen believed rather than a thing the app enforced.
     *
     * Found while adding the per-line FX rate: the sheet stops offering the box
     * once a run is finalised, and the server took the value anyway.
     *
     * The way back is `reopen`, which exists and says what it costs.
     */
    if (line.runStatus !== "draft") {
      throw new BadRequestException(
        "That sheet has been finalised — reopen it before changing a figure.",
      );
    }
    if (line.isPaid) {
      throw new BadRequestException(
        "This person has been paid — the figures cannot change now.",
      );
    }

    /*
     * Working days drive the money — the owner's rule, all of it in one place:
     *
     *   - the divisor is the month's own calendar length, 28 to 31, never a
     *     typed convention like 26 or 30;
     *   - the gross becomes salary x days / length, and every earnings line
     *     scales with it so the slip's parts still sum to its total;
     *   - the tax is then worked out on the PRO-RATED figure. Ten days of a
     *     30k month is taxed as a ~10k month, not as a 30k one;
     *   - null puts the full month back, figures and all.
     *
     * The base is the person's monthly salary as recorded for this month, not
     * the line's current gross — the line's gross may itself already be
     * pro-rated, and 10 days of 10 days is how a second save would silently
     * halve somebody's pay.
     */
    let derived: {
      grossAmount: string;
      earningsBreakdown: PayslipBreakdown;
      workingDays: number | null;
    } | null = null;

    if (input.workingDays !== undefined) {
      const monthEnd = lastDayOf(line.periodYear, line.periodMonth);
      const daysInMonth = Number(monthEnd.slice(8, 10));
      if (input.workingDays !== null && input.workingDays > daysInMonth) {
        throw new BadRequestException({
          message: "Validation failed",
          errors: {
            workingDays: [`That month has ${daysInMonth} days`],
          },
        });
      }

      const [pay] = await this.db.client
        .select({
          grossAmount: compensationHistory.grossAmount,
          components: compensationHistory.components,
        })
        .from(compensationHistory)
        .where(
          and(
            isNull(compensationHistory.deletedAt),
            eq(compensationHistory.teamMemberId, line.teamMemberId),
            sql`${compensationHistory.effectiveFrom} <= ${monthEnd}`,
          ),
        )
        .orderBy(desc(compensationHistory.effectiveFrom))
        .limit(1);

      if (!pay) {
        throw new BadRequestException({
          message: "Validation failed",
          errors: {
            workingDays: [
              "No monthly salary on record to pro-rate from — set their pay first",
            ],
          },
        });
      }

      const salarySplit = await this.readSalarySplit();
      const fullMonth = seedBreakdown(
        pay.components,
        pay.grossAmount,
        salarySplit,
      );

      if (input.workingDays === null) {
        derived = {
          grossAmount: pay.grossAmount,
          earningsBreakdown: fullMonth,
          workingDays: null,
        };
      } else {
        const factor = input.workingDays / daysInMonth;
        /* Rounded to a whole taka. Days worked out of the month's own length
           is the other place paisa came from: 90,000 x 18/31 is 52,258.0645,
           and the owner asked for none of it. */
        const grossFor = Math.round(Number(pay.grossAmount) * factor).toFixed(
          2,
        );
        derived = {
          grossAmount: grossFor,
          earningsBreakdown: scaleBreakdown(fullMonth, factor, grossFor),
          workingDays: input.workingDays,
        };
      }
    }

    /*
     * The tax is an output, so it moves whenever anything under it does — the
     * gross, the working days that re-figure it, or what the person declared
     * having invested.
     *
     * Unless somebody typed it. A figure entered by hand survives the next
     * edit to the same row, and that is the whole point of the mark: without
     * it, typing a tax and then correcting a working day would wipe the tax
     * with no message, which reads as the edit box not working rather than as
     * the rule reasserting itself. `recalculateTds` is the deliberate way back.
     *
     * Typing a tax IN this request beats everything: it is the most recent
     * statement of intent, and it sets the mark.
     */
    const typing = input.tdsAmount !== undefined;
    const wasTyped = line.tdsManual && !typing;

    const recompute =
      !typing &&
      !wasTyped &&
      (derived !== null ||
        input.grossAmount !== undefined ||
        input.tdsDeclaredInvestment !== undefined);

    const computed = recompute
      ? await this.computeTds(
          line.periodYear,
          line.periodMonth,
          derived?.grossAmount ?? input.grossAmount ?? line.grossAmount,
          input.tdsDeclaredInvestment ?? line.tdsDeclaredInvestment,
        )
      : null;

    const gross = Number(
      derived?.grossAmount ?? input.grossAmount ?? line.grossAmount,
    );
    const tds = Number(
      input.tdsAmount ?? computed?.tdsAmount ?? line.tdsAmount,
    );

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
            ...(derived ?? {}),
            ...(computed ?? {}),
            /*
             * Typing the tax marks the line and clears the working, because
             * there no longer is one: `tdsBasis` is what the computed figure
             * was worked out from, and leaving the old rule's arithmetic sitting
             * behind a hand-entered number is precisely the lie the schema's
             * old comment refused to allow.
             */
            ...(typing ? { tdsManual: true, tdsBasis: null } : {}),
            /*
             * A gross typed straight into the sheet is a hand-set figure, and
             * a day count left standing beside it would claim the figure came
             * from the days. The explicit act wins; the count clears.
             */
            ...(input.grossAmount !== undefined &&
            input.workingDays === undefined
              ? { workingDays: null }
              : {}),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(payrollLines.id, lineId));
        await this.recalculate(tx, line.runId);
      },
    });

    /*
     * Two things can be worth saying, and the quieter one matters more.
     *
     * A recompute that did not happen is invisible: the gross changes, the tax
     * stays where it was typed, and nothing on the screen accounts for it. So
     * it is said out loud whenever this request would otherwise have moved the
     * figure.
     */
    const held =
      wasTyped &&
      (derived !== null ||
        input.grossAmount !== undefined ||
        input.tdsDeclaredInvestment !== undefined);

    const warning =
      gross > 0 && tds > gross * TDS_WARNING_RATIO
        ? `Tax is ${((tds / gross) * 100).toFixed(0)}% of gross — worth a second look.`
        : held
          ? "The tax was typed by hand, so it was left as it is. Work out the tax again to put the rule back."
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
    // Salary leaves the paying account like any other money: not past zero.
    const watch = await overdraftWatch(this.db.client, [input.accountId]);

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
              // Every ledger row states the day's rate, this one included.
              usdRate: input.usdRate,
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
                // Every ledger row states the day's rate, this one included.
                usdRate: input.usdRate,
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
        await watch.assert(tx);
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
    let replaced = 0;

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
            tdsManual: payrollLines.tdsManual,
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
          if (line.tdsManual) replaced++;

          await tx
            .update(payrollLines)
            .set({
              tdsAmount,
              tdsBasis,
              /*
               * This is the one deliberate way back to the rule, so it clears
               * the hand-typed mark across the whole run. It is also the only
               * thing that overwrites a typed figure — which is why the count
               * of how many it replaced is reported rather than swallowed.
               */
              tdsManual: false,
              updatedAt: new Date(),
              updatedBy: actor.id,
            })
            .where(eq(payrollLines.id, line.id));
        }

        await this.recalculate(tx, runId);
        return lines.length;
      },
    });

    const typed = replaced
      ? ` ${replaced} hand-typed ${replaced === 1 ? "figure was" : "figures were"} replaced by the rule.`
      : "";

    return {
      changed,
      message:
        (unset
          ? `No tax rule is set up for that year, so ${unset} of the figures are zero. Settings → Salary TDS has the form.`
          : `${changed} ${changed === 1 ? "figure" : "figures"} changed.`) +
        typed,
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
  /** The salary split, read once per operation — one row, one rule. */
  private async readSalarySplit() {
    const [settingsRow] = await this.db.client
      .select({ salarySplit: appSettings.salarySplit })
      .from(appSettings)
      .limit(1);
    const parsedSplit = salarySplitSchema.safeParse(settingsRow?.salarySplit);
    return parsedSplit.success && parsedSplit.data.length
      ? parsedSplit.data
      : DEFAULT_SALARY_SPLIT;
  }

  /**
   * One person onto one sheet — the single definition of what a line is.
   *
   * Both doors build lines through this: the full rebuild, and the member
   * sync that adds people one at a time while a run is a draft. Two copies of
   * this loop body would disagree about the tax or the snapshots within a
   * month of each other.
   */
  private async buildLine(
    tx: DbTransaction,
    run: { id: string; periodYear: number; periodMonth: number },
    employee: {
      id: string;
      fullName: string;
      designation: string | null;
      department: string | null;
      bankName: string | null;
      bankAccountNumber: string | null;
      etin: string | null;
    },
    salarySplit: SalarySplit,
    actorId: string,
  ): Promise<"added" | "added-without-tax-rule" | "no-pay"> {
    const monthEnd = lastDayOf(run.periodYear, run.periodMonth);

    const [pay] = await tx
      .select({
        grossAmount: compensationHistory.grossAmount,
        components: compensationHistory.components,
      })
      .from(compensationHistory)
      .where(
        and(
          // A deleted salary row must not decide anybody's pay — the same
          // clause every other compensation read carries.
          isNull(compensationHistory.deletedAt),
          eq(compensationHistory.teamMemberId, employee.id),
          sql`${compensationHistory.effectiveFrom} <= ${monthEnd}`,
        ),
      )
      .orderBy(desc(compensationHistory.effectiveFrom))
      .limit(1);

    if (!pay) return "no-pay";

    // Worked out here rather than typed later: the sheet arrives with the tax
    // already on it, and the figure carries the rule that produced it.
    const { tdsAmount, tdsBasis } = await this.computeTds(
      run.periodYear,
      run.periodMonth,
      pay.grossAmount,
      null,
    );

    await tx.insert(payrollLines).values({
      payrollRunId: run.id,
      teamMemberId: employee.id,
      grossAmount: pay.grossAmount,
      tdsAmount,
      tdsBasis,
      // Frozen here rather than read at print time: this is what the split
      // was in this month. When nobody has recorded one, the whole gross
      // becomes a single Basic Salary line — true, and what somebody would
      // have typed by hand anyway.
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
      updatedBy: actorId,
    });

    return tdsBasis ? "added" : "added-without-tax-rule";
  }

  /**
   * Who could be on a month's sheet, with what they would be paid.
   *
   * The same eligibility the rebuild uses — employees, employed at some point
   * in the month, not deleted — plus each person's pay as of the month's end,
   * left null rather than zero when none is recorded so the picker can say
   * "no pay recorded" instead of listing a wage of nothing.
   */
  async eligibleMembers(periodYear: number, periodMonth: number) {
    const monthEnd = lastDayOf(periodYear, periodMonth);
    const monthStart = firstDayOf(periodYear, periodMonth);

    return (
      this.db.client
        .select({
          id: teamMembers.id,
          fullName: teamMembers.fullName,
          designation: teamMembers.designation,
          department: teamMembers.department,
          status: teamMembers.status,
          /*
           * The correlation is written out as "team_members".id, not
           * interpolated. Drizzle renders an embedded column as its bare name —
           * just "id" — and inside this subquery a bare "id" resolves against
           * compensation_history first, so the correlation quietly became
           * ch.team_member_id = ch.id: valid SQL, false on every row, and a
           * picker that said nobody in the company had a wage.
           */
          monthlyGross: sql<string | null>`(
          select ch.gross_amount::text from compensation_history ch
           where ch.team_member_id = "team_members".id
             and ch.deleted_at is null
             and ch.effective_from <= ${monthEnd}
           order by ch.effective_from desc limit 1
        )`,
        })
        .from(teamMembers)
        .where(
          and(
            isNull(teamMembers.deletedAt),
            eq(teamMembers.engagementType, "employee"),
            sql`${teamMembers.joinedOn} <= ${monthEnd}`,
            sql`(${teamMembers.endedOn} is null or ${teamMembers.endedOn} >= ${monthStart})`,
          ),
        )
        // The picker reads in the same order as the sheet it feeds.
        .orderBy(
          asc(teamMembers.joinedOn),
          asc(teamMembers.fullName),
          asc(teamMembers.id),
        )
    );
  }

  /**
   * Makes a draft run hold exactly these people — and nobody's edits are lost.
   *
   * The owner's ask: choose who is on a month when it is started, and keep
   * choosing until it is finalised. The rebuild cannot serve that — it wipes
   * every line, and with them the bonuses and deductions somebody has already
   * typed. This one is surgical: people leaving the list lose their line,
   * people joining it gain one built the standard way, and everyone who stays
   * is not touched at all.
   */
  async syncMembers(
    runId: string,
    input: SyncRunMembersInput,
    actor: AuthenticatedUser,
  ) {
    const { run } = await this.getRun(runId);

    if (run.status !== "draft") {
      throw new BadRequestException(
        "This run is finalised — reopen it before changing who is on it.",
      );
    }

    const wanted = new Set(input.teamMemberIds);

    // Only people who could be on this month's sheet at all. An id outside
    // the eligible set is a caller error worth naming, not skipping.
    const eligible = await this.eligibleMembers(
      run.periodYear,
      run.periodMonth,
    );
    const eligibleById = new Map(eligible.map((e) => [e.id, e]));
    for (const id of wanted) {
      if (!eligibleById.has(id)) {
        throw new BadRequestException(
          "Somebody on that list was not employed in that month.",
        );
      }
    }

    const existing = await this.db.client
      .select({
        id: payrollLines.id,
        teamMemberId: payrollLines.teamMemberId,
        isPaid: payrollLines.isPaid,
      })
      .from(payrollLines)
      .where(eq(payrollLines.payrollRunId, runId));
    const existingByMember = new Map(existing.map((l) => [l.teamMemberId, l]));

    const toRemove = existing.filter((l) => !wanted.has(l.teamMemberId));
    const toAdd = [...wanted].filter((id) => !existingByMember.has(id));

    // A paid line is money that left the account; it does not quietly drop
    // off a sheet. (A draft run should hold none, but "should" is not a
    // guard.)
    if (toRemove.some((l) => l.isPaid)) {
      throw new BadRequestException(
        "Somebody on this run has already been paid — their line cannot be removed.",
      );
    }

    if (!toRemove.length && !toAdd.length) {
      return { added: 0, removed: 0, skipped: [] as string[] };
    }

    const salarySplit = await this.readSalarySplit();
    const skipped: string[] = [];
    let noTaxRule = false;

    const result = await this.audit.mutate({
      action: "update",
      entityTable: "payroll_runs",
      entityId: runId,
      summary:
        `Changed who is on ${run.label}: ` +
        [
          toAdd.length ? `added ${toAdd.length}` : null,
          toRemove.length ? `removed ${toRemove.length}` : null,
        ]
          .filter(Boolean)
          .join(", "),
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
        let added = 0;

        if (toRemove.length) {
          await tx.delete(payrollLines).where(
            inArray(
              payrollLines.id,
              toRemove.map((l) => l.id),
            ),
          );
        }

        for (const id of toAdd) {
          const employee = await this.memberForLine(tx, id);
          const built = await this.buildLine(
            tx,
            run,
            employee,
            salarySplit,
            actor.id,
          );
          if (built === "no-pay") {
            skipped.push(employee.fullName);
            continue;
          }
          if (built === "added-without-tax-rule") noTaxRule = true;
          added++;
        }

        await this.recalculate(tx, runId);
        return { added, removed: toRemove.length };
      },
    });

    const notes = [
      skipped.length
        ? `${skipped.length} left out because no pay is recorded for them: ${skipped.join(", ")}`
        : null,
      noTaxRule
        ? "No tax rule is set up for that income year, so their tax is zero. Settings \u2192 Salary TDS has the form."
        : null,
    ].filter(Boolean);

    return {
      ...result,
      skipped,
      message: notes.length ? notes.join(" ") : undefined,
    };
  }

  /** The snapshot fields a line freezes, read for one person. */
  private async memberForLine(tx: DbTransaction, teamMemberId: string) {
    const [employee] = await tx
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
      .where(eq(teamMembers.id, teamMemberId))
      .limit(1);
    if (!employee) throw new NotFoundException("No such team member");
    return employee;
  }

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

/**
 * The full month's parts, shrunk to the days actually worked.
 *
 * Each line scales by the same factor and is rounded to the whole taka;
 * rounding drift is then pinned on the largest line so the parts still sum to
 * exactly the pro-rated gross. Without the pin, four rounded lines disagree with
 * their own total by a paisa or two, and a slip whose arithmetic does not
 * tie is a slip nobody trusts again.
 */
function scaleBreakdown(
  parts: PayslipBreakdown,
  factor: number,
  targetGross: string,
): PayslipBreakdown {
  if (!parts.length) return [{ label: "Basic Salary", amount: targetGross }];
  const scaled = parts.map((part) => ({
    label: part.label,
    /* Whole taka, like the gross they have to add up to. */
    value: Math.round(Number(part.amount) * factor),
  }));
  const sum = scaled.reduce((total, part) => total + part.value, 0);
  const drift = Number((Number(targetGross) - sum).toFixed(2));
  if (drift !== 0) {
    const largest = scaled.reduce((a, b) => (b.value > a.value ? b : a));
    largest.value = Number((largest.value + drift).toFixed(2));
  }
  return scaled.map((part) => ({
    label: part.label,
    amount: part.value.toFixed(2),
  }));
}

function lastDayOf(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${day}`;
}
