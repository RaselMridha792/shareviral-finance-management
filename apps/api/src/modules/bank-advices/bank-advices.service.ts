import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Paginated } from "@finance/shared";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import {
  accounts,
  bankAdviceLines,
  bankAdvices,
  payrollLines,
  payrollRuns,
  teamMembers,
} from "../../db/schema";
import {
  SCB_CODE,
  adviceProblems,
  buildCsv,
  cleanAccountNo,
  cleanBankCode,
  debitAccountNoOf,
  isScb,
  lineProblems,
  type AdviceInput,
  type FromPayrollInput,
  type LineInput,
  type ListAdvicesQuery,
} from "./bank-format";
import { buildWorkbook } from "./bank-workbook";

export type BankAdviceRow = {
  id: string;
  title: string;
  payrollRunId: string | null;
  runLabel: string | null;
  accountId: string | null;
  accountName: string | null;
  debitAccountNo: string;
  debitCityCode: string;
  valueDate: string;
  note: string | null;
  lineCount: number;
  /** Lines missing their account number or bank code, or with no amount. */
  incompleteCount: number;
  /** Summed in SQL. */
  totalAmount: string;
  downloadedAt: string | null;
  downloadedByName: string | null;
  createdAt: string;
  createdByName: string | null;
};

export type BankAdviceLineDto = {
  id: string;
  position: number;
  paymentType: string;
  beneficiaryName: string;
  bankCode: string;
  accountNo: string;
  paymentDetails: string;
  currency: string;
  amount: string;
  email: string | null;
  teamMemberId: string | null;
  payrollLineId: string | null;
  problems: string[];
};

export type BankAdviceDto = BankAdviceRow & {
  lines: BankAdviceLineDto[];
  /** What stops the file downloading, about the file itself. */
  problems: string[];
};

/**
 * Bank advices — the monthly payment file for the bank, built from a salary
 * sheet and kept, instead of typed into the bank's spreadsheet by hand.
 *
 * The owner, 29 Sep 2026: *"amake every month bank a ekta excel sheet submit
 * korte hoy jeta manually banano onek problem ... eta mainly generate hobe
 * payroll theke"*. `bank-format.ts` holds the bank's rules; this holds the
 * advices, their lines, and the two downloads.
 *
 * Reading is `payroll.read`; building, changing and downloading are
 * `payroll.pay` — the file is the instruction that sends the salaries out,
 * which is the act that permission already names. Deleting an advice goes
 * through the trash (kind "bank-advice").
 */
@Injectable()
export class BankAdvicesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Reading                                                            */
  /* ------------------------------------------------------------------ */

  private rowSql(where: ReturnType<typeof sql>) {
    return sql`
      select a.id::text as "id",
             a.title as "title",
             a.payroll_run_id::text as "payrollRunId",
             r.label as "runLabel",
             a.account_id::text as "accountId",
             acc.name as "accountName",
             a.debit_account_no as "debitAccountNo",
             a.debit_city_code as "debitCityCode",
             a.value_date::text as "valueDate",
             a.note as "note",
             (select count(*)::int from bank_advice_lines l
               where l.bank_advice_id = a.id) as "lineCount",
             (select count(*)::int from bank_advice_lines l
               where l.bank_advice_id = a.id
                 and (l.bank_code = '' or l.account_no = '' or l.amount <= 0)) as "incompleteCount",
             (select coalesce(sum(l.amount), 0)::text from bank_advice_lines l
               where l.bank_advice_id = a.id) as "totalAmount",
             -- In Dhaka, to the minute: a file downloaded after midnight here
             -- is still yesterday in UTC.
             to_char(a.downloaded_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI') as "downloadedAt",
             du.full_name as "downloadedByName",
             a.created_at::text as "createdAt",
             cu.full_name as "createdByName"
        from bank_advices a
        left join payroll_runs r on r.id = a.payroll_run_id
        left join accounts acc on acc.id = a.account_id
        left join users du on du.id = a.downloaded_by
        left join users cu on cu.id = a.created_by
       where a.deleted_at is null and ${where}`;
  }

  async list(query: ListAdvicesQuery): Promise<Paginated<BankAdviceRow>> {
    const like = query.q ? `%${query.q}%` : null;
    const where = like
      ? sql`(a.title ilike ${like} or r.label ilike ${like})`
      : sql`true`;

    const [rows, counted] = await Promise.all([
      this.db.client.execute(
        sql`${this.rowSql(where)}
            order by a.value_date desc, a.created_at desc
            limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
      ),
      this.db.client.execute(
        sql`select count(*)::int as n
              from bank_advices a
              left join payroll_runs r on r.id = a.payroll_run_id
             where a.deleted_at is null and ${where}`,
      ),
    ]);
    const total = Number(
      (counted.rows as unknown as { n: number }[])[0]?.n ?? 0,
    );
    return {
      items: rows.rows as unknown as BankAdviceRow[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: string): Promise<BankAdviceDto> {
    const found = await this.db.client.execute(
      this.rowSql(sql`a.id = ${id}::uuid`),
    );
    const row = (found.rows as unknown as BankAdviceRow[])[0];
    if (!row) throw new NotFoundException("That bank advice is not here");

    const lines = await this.db.client
      .select({
        id: bankAdviceLines.id,
        position: bankAdviceLines.position,
        paymentType: bankAdviceLines.paymentType,
        beneficiaryName: bankAdviceLines.beneficiaryName,
        bankCode: bankAdviceLines.bankCode,
        accountNo: bankAdviceLines.accountNo,
        paymentDetails: bankAdviceLines.paymentDetails,
        currency: bankAdviceLines.currency,
        amount: bankAdviceLines.amount,
        email: bankAdviceLines.email,
        teamMemberId: bankAdviceLines.teamMemberId,
        payrollLineId: bankAdviceLines.payrollLineId,
      })
      .from(bankAdviceLines)
      .where(eq(bankAdviceLines.bankAdviceId, id))
      .orderBy(asc(bankAdviceLines.position), asc(bankAdviceLines.createdAt));

    return {
      ...row,
      lines: lines.map((line) => ({ ...line, problems: lineProblems(line) })),
      problems: adviceProblems({ ...row, lineCount: lines.length }),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Building                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * An advice from a salary sheet: one line for every person on it with pay
   * to send, their bank details from their team record.
   *
   * - The bank code: SCBLBDDXXXX when their bank is Standard Chartered (by
   *   SWIFT, else by name), otherwise two zeros and their routing number.
   * - The account: the number on their record now, else the one the sheet
   *   was built with — the file pays today, so today's account is the one.
   * - The name: the account holder's, when the record has one — a bank
   *   refuses a name the account does not carry.
   * - Nothing to pay (a net of zero), or paid to a mobile wallet with no bank
   *   account on file: left out, and named in `skipped`.
   * - No bank details at all: IN, with the gaps to fill here. Dropping them
   *   would send a file a person short and say nothing.
   */
  async fromPayroll(input: FromPayrollInput, actor: AuthenticatedUser) {
    const [run] = await this.db.client
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.id, input.payrollRunId),
          isNull(payrollRuns.deletedAt),
        ),
      )
      .limit(1);
    if (!run) throw new NotFoundException("That salary sheet is not here");

    const accountId = input.accountId ?? run.accountId;
    const account = accountId ? await this.accountOf(accountId) : null;

    const people = await this.db.client
      .select({
        lineId: payrollLines.id,
        teamMemberId: teamMembers.id,
        fullName: teamMembers.fullName,
        bankName: teamMembers.bankName,
        bankAccountHolder: teamMembers.bankAccountHolder,
        bankAccountNumber: teamMembers.bankAccountNumber,
        bankRouting: teamMembers.bankRouting,
        bankSwift: teamMembers.bankSwift,
        walletProvider: teamMembers.walletProvider,
        walletNumber: teamMembers.walletNumber,
        workEmail: teamMembers.workEmail,
        personalEmail: teamMembers.personalEmail,
        snapshotBankName: payrollLines.snapshotBankName,
        snapshotBankAccount: payrollLines.snapshotBankAccount,
        net: sql<string>`coalesce(${payrollLines.netAmountOverride}, ${payrollLines.netAmount})::text`,
      })
      .from(payrollLines)
      .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
      .where(eq(payrollLines.payrollRunId, run.id))
      .orderBy(
        asc(teamMembers.joinedOn),
        asc(teamMembers.fullName),
        asc(teamMembers.id),
      );

    const skipped: { name: string; reason: string }[] = [];
    const lines: (LineInput & {
      teamMemberId: string;
      payrollLineId: string;
    })[] = [];
    for (const person of people) {
      if (!(Number(person.net) > 0)) {
        skipped.push({ name: person.fullName, reason: "Nothing to pay" });
        continue;
      }
      const accountNo = cleanAccountNo(
        person.bankAccountNumber || person.snapshotBankAccount,
      );
      if (!accountNo && person.walletNumber) {
        skipped.push({
          name: person.fullName,
          reason: `Paid to ${person.walletProvider || "a mobile wallet"}, no bank account on file`,
        });
        continue;
      }
      const bankName = person.bankName || person.snapshotBankName;
      lines.push({
        paymentType: input.paymentType,
        beneficiaryName: (person.bankAccountHolder || person.fullName).trim(),
        bankCode: isScb(bankName, person.bankSwift)
          ? SCB_CODE
          : cleanBankCode(person.bankRouting),
        accountNo,
        paymentDetails: input.paymentDetails,
        amount: person.net,
        email: input.includeEmails
          ? person.workEmail || person.personalEmail || null
          : null,
        teamMemberId: person.teamMemberId,
        payrollLineId: person.lineId,
      });
    }

    const title = input.title || `Salary — ${run.label}`;
    const created = await this.audit.mutate({
      action: "create",
      entityTable: "bank_advices",
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} built the bank advice "${title}" from the ${run.label} salary sheet — ${lines.length} payments`,
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [advice] = await tx
          .insert(bankAdvices)
          .values({
            title,
            payrollRunId: run.id,
            accountId: account?.id ?? null,
            debitAccountNo: debitAccountNoOf(account?.accountNumber),
            valueDate: input.valueDate,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: bankAdvices.id });
        if (lines.length > 0) {
          await tx.insert(bankAdviceLines).values(
            lines.map((line, index) => ({
              bankAdviceId: advice.id,
              position: index + 1,
              ...line,
            })),
          );
        }
        return { id: advice.id, title, payments: lines.length };
      },
    });

    return { advice: await this.get(created.id), skipped };
  }

  /** An advice with nothing in it — a payment that is not a salary. */
  async create(input: AdviceInput, actor: AuthenticatedUser) {
    const debit = await this.debitOf(input);
    const created = await this.audit.mutate({
      action: "create",
      entityTable: "bank_advices",
      module: "payroll",
      summary: `${actor.fullName} started the bank advice "${input.title}"`,
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const [advice] = await tx
          .insert(bankAdvices)
          .values({
            title: input.title,
            accountId: input.accountId ?? null,
            debitAccountNo: debit,
            debitCityCode: input.debitCityCode,
            valueDate: input.valueDate,
            note: input.note ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: bankAdvices.id });
        return { id: advice.id, title: input.title };
      },
    });
    return this.get(created.id);
  }

  async update(id: string, input: AdviceInput, actor: AuthenticatedUser) {
    await this.get(id);
    const debit = await this.debitOf(input);
    await this.audit.mutate({
      action: "update",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      summary: `${actor.fullName} changed the bank advice "${input.title}"`,
      read: (tx) => this.snapshot(tx, id),
      run: async (tx) => {
        await tx
          .update(bankAdvices)
          .set({
            title: input.title,
            accountId: input.accountId ?? null,
            debitAccountNo: debit,
            debitCityCode: input.debitCityCode,
            valueDate: input.valueDate,
            note: input.note ?? null,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(bankAdvices.id, id));
      },
    });
    return this.get(id);
  }

  async addLine(id: string, input: LineInput, actor: AuthenticatedUser) {
    const advice = await this.get(id);
    const values = this.lineValues(input);
    await this.audit.mutate({
      action: "update",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} added a payment of ${values.amount} to ${values.beneficiaryName} on the bank advice "${advice.title}"`,
      read: (tx) => this.snapshot(tx, id),
      run: async (tx) => {
        const [{ last }] = await tx
          .select({ last: max(bankAdviceLines.position) })
          .from(bankAdviceLines)
          .where(eq(bankAdviceLines.bankAdviceId, id));
        await tx.insert(bankAdviceLines).values({
          bankAdviceId: id,
          position: (last ?? 0) + 1,
          ...values,
        });
        await this.touch(tx, id, actor);
      },
    });
    return this.get(id);
  }

  async updateLine(
    id: string,
    lineId: string,
    input: LineInput,
    actor: AuthenticatedUser,
  ) {
    const advice = await this.get(id);
    const line = advice.lines.find((one) => one.id === lineId);
    if (!line)
      throw new NotFoundException("That payment is not on this advice");
    const values = this.lineValues(input);
    await this.audit.mutate({
      action: "update",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} changed ${line.beneficiaryName}'s payment on the bank advice "${advice.title}"`,
      read: (tx) => this.snapshot(tx, id),
      run: async (tx) => {
        await tx
          .update(bankAdviceLines)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(bankAdviceLines.id, lineId));
        await this.touch(tx, id, actor);
      },
    });
    return this.get(id);
  }

  /**
   * A payment off the advice. Gone for good rather than to the trash: it is
   * a row of the file being written, like a cell cleared in the sheet it
   * replaces — the advice itself goes to the trash when it is deleted, and
   * the audit row says what this one was.
   */
  async removeLine(id: string, lineId: string, actor: AuthenticatedUser) {
    const advice = await this.get(id);
    const line = advice.lines.find((one) => one.id === lineId);
    if (!line)
      throw new NotFoundException("That payment is not on this advice");
    await this.audit.mutate({
      action: "update",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} took ${line.beneficiaryName}'s payment of ${line.amount} off the bank advice "${advice.title}"`,
      read: (tx) => this.snapshot(tx, id),
      run: async (tx) => {
        await tx.delete(bankAdviceLines).where(eq(bankAdviceLines.id, lineId));
        await this.touch(tx, id, actor);
      },
    });
    return this.get(id);
  }

  /* ------------------------------------------------------------------ */
  /*  The files                                                          */
  /* ------------------------------------------------------------------ */

  /** Everything that stops the file, in one sentence the page can show. */
  private assertReady(advice: BankAdviceDto) {
    const broken = advice.lines.filter((line) => line.problems.length > 0);
    if (advice.problems.length === 0 && broken.length === 0) return;
    const parts = [
      ...advice.problems,
      ...broken
        .slice(0, 5)
        .map((line) => `${line.beneficiaryName}: ${line.problems[0]}`),
    ];
    if (broken.length > 5) parts.push(`and ${broken.length - 5} more`);
    throw new BadRequestException(
      `This file is not ready for the bank. ${parts.join("; ")}.`,
    );
  }

  private fileOf(advice: BankAdviceDto) {
    return {
      advice: {
        debitAccountNo: advice.debitAccountNo,
        debitCityCode: advice.debitCityCode,
        valueDate: advice.valueDate,
      },
      lines: advice.lines,
    };
  }

  /**
   * Named as the bank names its own: "Bank Standard Format Final" — the file
   * its instructions save — then which advice it is.
   */
  private fileName(advice: BankAdviceDto, extension: "csv" | "xlsx") {
    const safe = advice.title.replace(/[\\/:*?"<>|]+/g, "-").trim();
    return `Bank Standard Format Final - ${safe}.${extension}`;
  }

  /**
   * The CSV that is uploaded to S2B. Downloading it stamps the advice, so
   * the list can say which files have gone to the bank and who took them.
   */
  async csv(id: string, actor: AuthenticatedUser) {
    const advice = await this.get(id);
    this.assertReady(advice);
    const { advice: head, lines } = this.fileOf(advice);
    const buffer = buildCsv(head, lines);

    await this.db.client
      .update(bankAdvices)
      .set({ downloadedAt: new Date(), downloadedBy: actor.id })
      .where(eq(bankAdvices.id, id));
    await this.audit.log({
      action: "export",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} downloaded the bank advice "${advice.title}" for upload — ${advice.lines.length} payments, ${advice.totalAmount}`,
    });
    return { buffer, filename: this.fileName(advice, "csv") };
  }

  /** The same payments in the bank's own workbook, to read and keep. */
  async workbook(id: string, actor: AuthenticatedUser) {
    const advice = await this.get(id);
    this.assertReady(advice);
    const { advice: head, lines } = this.fileOf(advice);
    const buffer = await buildWorkbook(head, lines);
    await this.audit.log({
      action: "export",
      entityTable: "bank_advices",
      entityId: id,
      module: "payroll",
      isSensitive: true,
      summary: `${actor.fullName} downloaded the bank advice "${advice.title}" as Excel`,
    });
    return { buffer, filename: this.fileName(advice, "xlsx") };
  }

  /* ------------------------------------------------------------------ */

  private lineValues(input: LineInput) {
    return {
      paymentType: input.paymentType,
      beneficiaryName: input.beneficiaryName.trim(),
      bankCode: cleanBankCode(input.bankCode),
      accountNo: cleanAccountNo(input.accountNo),
      paymentDetails: input.paymentDetails.trim(),
      amount: input.amount,
      email: input.email || null,
    };
  }

  private async accountOf(id: string) {
    const [account] = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        accountNumber: accounts.accountNumber,
      })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    if (!account) throw new BadRequestException("That account is not here");
    return account;
  }

  /** The debit account as the file writes it: typed, else the account's. */
  private async debitOf(input: AdviceInput): Promise<string> {
    const typed = (input.debitAccountNo ?? "").replace(/\D/g, "");
    if (typed) return typed;
    if (!input.accountId) return "";
    return debitAccountNoOf(
      (await this.accountOf(input.accountId)).accountNumber,
    );
  }

  private async touch(tx: DbTransaction, id: string, actor: AuthenticatedUser) {
    await tx
      .update(bankAdvices)
      .set({ updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(bankAdvices.id, id));
  }

  /** The advice and its payments, as the audit log keeps them. */
  private async snapshot(tx: DbTransaction, id: string) {
    const [advice] = await tx
      .select({
        title: bankAdvices.title,
        accountId: bankAdvices.accountId,
        debitAccountNo: bankAdvices.debitAccountNo,
        debitCityCode: bankAdvices.debitCityCode,
        valueDate: bankAdvices.valueDate,
        note: bankAdvices.note,
      })
      .from(bankAdvices)
      .where(eq(bankAdvices.id, id))
      .limit(1);
    const lines = await tx
      .select({
        beneficiaryName: bankAdviceLines.beneficiaryName,
        paymentType: bankAdviceLines.paymentType,
        bankCode: bankAdviceLines.bankCode,
        accountNo: bankAdviceLines.accountNo,
        amount: bankAdviceLines.amount,
      })
      .from(bankAdviceLines)
      .where(eq(bankAdviceLines.bankAdviceId, id))
      .orderBy(asc(bankAdviceLines.position));
    return { ...advice, lines };
  }
}
