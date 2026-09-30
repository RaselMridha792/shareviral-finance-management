import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { formatIsoDate, formatMoney, type Paginated } from "@finance/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  hrBudgetPeriods,
  hrBudgetSpends,
  teamMembers,
  users,
} from "../../db/schema";
import { NotificationsService } from "../notifications/notifications.service";
import { TransactionsService } from "../transactions/transactions.service";
import type {
  DecisionInput,
  ListPeriodsQuery,
  ListSpendsQuery,
  PaySpendInput,
  SubmitPeriodInput,
  SubmitSpendInput,
} from "./hr-budget.schemas";

/** What the HR portal reads back about a budget. */
export type PeriodState = {
  externalId: string;
  status: "received" | "approved" | "refused" | "held";
  statusNote: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  receivedAt: Date;
  updatedAt: Date;
};

/** What the HR portal reads back about a spend. */
export type SpendState = {
  externalId: string;
  budgetExternalId: string;
  /** Whether the budget it names has arrived here. */
  budgetKnown: boolean;
  status: "received" | "approved" | "refused" | "held" | "paid";
  statusNote: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  paidOn: string | null;
  receivedAt: Date;
  updatedAt: Date;
};

/** A send's result: which it was, and the state the answer carries. */
export type Submitted<T> = {
  outcome: "created" | "amended" | "conflict";
  state: T;
};

export type PeriodRow = PeriodState & {
  id: string;
  categoryName: string;
  startsOn: string;
  endsOn: string;
  amount: string;
  note: string | null;
  recordedByName: string;
  sendCount: number;
  spendCount: number;
  /** Every spend not refused, summed in SQL. */
  spentAmount: string;
  paidAmount: string;
};

export type SpendRow = SpendState & {
  id: string;
  spentOn: string;
  amount: string;
  purpose: string;
  teamMemberId: string | null;
  /** The person's name here, when the spend is linked to one. */
  teamMemberName: string | null;
  employeeName: string | null;
  hrStatus: "proposed" | "approved";
  hrApprovedByName: string | null;
  hrApprovedAt: Date | null;
  recordedByName: string;
  hasReceipt: boolean;
  sendCount: number;
  categoryName: string | null;
  budgetStartsOn: string | null;
  budgetEndsOn: string | null;
  budgetStatus: string | null;
  transactionId: string | null;
  transactionRef: string | null;
};

/**
 * HR Budget — what the HR portal sends finance, and what finance does with it.
 *
 * The owner, 30 Sep 2026: *"hr theke jokhon budget dibe kono kichur oita
 * finance a request jabe er jonne hr budet name finance a ekta new page o
 * banate hobe and properly sob information manage korte hobe"* — and, asked,
 * that both a budget and each spend against it come over, and that finance
 * approves, pays and records them.
 *
 * Two doors in (`hrbudget.submit`, the HR portal's login) and the page's
 * decisions (`hrbudget.manage`). A send is keyed on the HR portal's own id:
 * a repeat amends while finance has not acted, and is answered with the
 * current state — a conflict, not an overwrite — once it has. A spend may
 * arrive before its budget; it links itself when the budget does, and a
 * refused budget refuses nothing under it.
 *
 * Paying a spend writes an ordinary expense through the ledger's own door
 * (`TransactionsService.create`: the period lock, the overdraft rule, the
 * audit row), and the spend points at it.
 *
 * A request's first arrival rings the bell for the people who decide it
 * (#122), unless Settings → Notifications has it switched off.
 */
@Injectable()
export class HrBudgetService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  The HR portal's doors                                              */
  /* ------------------------------------------------------------------ */

  async submitPeriod(
    input: SubmitPeriodInput,
    actor: AuthenticatedUser,
  ): Promise<Submitted<PeriodState>> {
    const values = {
      categoryName: input.categoryName,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      amount: input.amount,
      note: input.note,
      recordedByName: input.recordedByName,
    };
    const written = await this.db.transaction(async (tx) => {
      /*
       * One statement: a first send inserts; a repeat amends only while the
       * row is still `received` — `setWhere` leaves a decided row alone and
       * returns nothing, which is the conflict. Two sends at once cannot
       * both insert; the unique key makes the second an amend.
       */
      const [row] = await tx
        .insert(hrBudgetPeriods)
        .values({ externalId: input.externalId, ...values })
        .onConflictDoUpdate({
          target: hrBudgetPeriods.externalId,
          set: {
            ...values,
            sendCount: sql`${hrBudgetPeriods.sendCount} + 1`,
            /* A resend after a hold answers it: back to waiting (#125). */
            status: "received",
            statusNote: null,
            decidedBy: null,
            decidedAt: null,
            updatedAt: new Date(),
          },
          setWhere: sql`${hrBudgetPeriods.status} in ('received', 'held')`,
        })
        .returning({
          id: hrBudgetPeriods.id,
          inserted: sql<boolean>`(xmax = 0)`,
        });
      if (!row) return null;
      await this.audit.record(tx, {
        action: row.inserted ? "create" : "update",
        entityTable: "hr_budget_periods",
        entityId: row.id,
        module: "hr-budget",
        summary: `${actor.fullName} ${row.inserted ? "sent" : "sent again"} the budget ${input.categoryName}, ${input.startsOn} to ${input.endsOn}, ${formatMoney(input.amount)}`,
        after: { externalId: input.externalId, ...values },
      });
      return row;
    });

    if (written?.inserted)
      await this.notifications.ringHrRequest({
        kind: "budget",
        id: written.id,
        title: `HR sent a budget: ${input.categoryName}`,
        body: `${formatMoney(input.amount, { currency: "BDT" })} for ${formatIsoDate(input.startsOn)} to ${formatIsoDate(input.endsOn)}, from ${input.recordedByName}. Waiting for a decision.`,
      });

    const [state] = await this.periodStates([input.externalId]);
    return {
      outcome: !written ? "conflict" : written.inserted ? "created" : "amended",
      state,
    };
  }

  async submitSpend(
    input: SubmitSpendInput,
    actor: AuthenticatedUser,
  ): Promise<Submitted<SpendState>> {
    if (input.teamMemberId) {
      const [member] = await this.db.client
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.id, input.teamMemberId),
            isNull(teamMembers.deletedAt),
          ),
        )
        .limit(1);
      if (!member) throw new NotFoundException("No such team member");
    }

    const values = {
      budgetExternalId: input.budgetExternalId,
      spentOn: input.spentOn,
      amount: input.amount,
      purpose: input.purpose,
      teamMemberId: input.teamMemberId,
      employeeName: input.employeeName,
      hrStatus: input.hrStatus,
      hrApprovedByName: input.hrApprovedByName,
      hrApprovedAt: input.hrApprovedAt ? new Date(input.hrApprovedAt) : null,
      recordedByName: input.recordedByName,
      hasReceipt: input.hasReceipt,
    };
    const written = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(hrBudgetSpends)
        .values({ externalId: input.externalId, ...values })
        .onConflictDoUpdate({
          target: hrBudgetSpends.externalId,
          set: {
            ...values,
            sendCount: sql`${hrBudgetSpends.sendCount} + 1`,
            status: "received",
            statusNote: null,
            decidedBy: null,
            decidedAt: null,
            updatedAt: new Date(),
          },
          setWhere: sql`${hrBudgetSpends.status} in ('received', 'held')`,
        })
        .returning({
          id: hrBudgetSpends.id,
          inserted: sql<boolean>`(xmax = 0)`,
        });
      if (!row) return null;
      await this.audit.record(tx, {
        action: row.inserted ? "create" : "update",
        entityTable: "hr_budget_spends",
        entityId: row.id,
        module: "hr-budget",
        summary: `${actor.fullName} ${row.inserted ? "sent" : "sent again"} a spend of ${formatMoney(input.amount)} on ${input.spentOn}: ${input.purpose}`,
        after: { externalId: input.externalId, ...values },
      });
      return row;
    });

    if (written?.inserted)
      await this.notifications.ringHrRequest({
        kind: "spend",
        id: written.id,
        title: `HR sent a spend: ${input.purpose}`,
        body: `${formatMoney(input.amount, { currency: "BDT" })}, spent on ${formatIsoDate(input.spentOn)}${input.employeeName ? ` for ${input.employeeName}` : ""}, from ${input.recordedByName}. Waiting for a decision.`,
      });

    const [state] = await this.spendStates([input.externalId]);
    return {
      outcome: !written ? "conflict" : written.inserted ? "created" : "amended",
      state,
    };
  }

  /** The states of the budgets named — the ones not here are left out. */
  async periodStates(externalIds: string[]): Promise<PeriodState[]> {
    return this.db.client
      .select({
        externalId: hrBudgetPeriods.externalId,
        status: sql<PeriodState["status"]>`${hrBudgetPeriods.status}`,
        statusNote: hrBudgetPeriods.statusNote,
        decidedByName: users.fullName,
        decidedAt: hrBudgetPeriods.decidedAt,
        receivedAt: hrBudgetPeriods.receivedAt,
        updatedAt: hrBudgetPeriods.updatedAt,
      })
      .from(hrBudgetPeriods)
      .leftJoin(users, eq(users.id, hrBudgetPeriods.decidedBy))
      .where(inArray(hrBudgetPeriods.externalId, externalIds));
  }

  /** The states of the spends named — the ones not here are left out. */
  async spendStates(externalIds: string[]): Promise<SpendState[]> {
    return this.db.client
      .select({
        externalId: hrBudgetSpends.externalId,
        budgetExternalId: hrBudgetSpends.budgetExternalId,
        budgetKnown: sql<boolean>`exists (
          select 1 from ${hrBudgetPeriods}
           where ${hrBudgetPeriods.externalId} = ${hrBudgetSpends.budgetExternalId})`,
        status: sql<SpendState["status"]>`${hrBudgetSpends.status}`,
        statusNote: hrBudgetSpends.statusNote,
        decidedByName: users.fullName,
        decidedAt: hrBudgetSpends.decidedAt,
        paidOn: hrBudgetSpends.paidOn,
        receivedAt: hrBudgetSpends.receivedAt,
        updatedAt: hrBudgetSpends.updatedAt,
      })
      .from(hrBudgetSpends)
      .leftJoin(users, eq(users.id, hrBudgetSpends.decidedBy))
      .where(inArray(hrBudgetSpends.externalId, externalIds));
  }

  /* ------------------------------------------------------------------ */
  /*  The page                                                           */
  /* ------------------------------------------------------------------ */

  async listPeriods(query: ListPeriodsQuery): Promise<Paginated<PeriodRow>> {
    const like = query.q ? `%${query.q}%` : null;
    const where = sql`true
      ${query.status ? sql`and p.status = ${query.status}` : sql``}
      ${like ? sql`and (p.category_name ilike ${like} or p.note ilike ${like} or p.recorded_by_name ilike ${like})` : sql``}`;
    const [rows, counted] = await Promise.all([
      this.db.client.execute(sql`
        select p.id::text as "id",
               p.external_id::text as "externalId",
               p.category_name as "categoryName",
               p.starts_on::text as "startsOn",
               p.ends_on::text as "endsOn",
               p.amount::text as "amount",
               p.note as "note",
               p.recorded_by_name as "recordedByName",
               p.status as "status",
               p.status_note as "statusNote",
               u.full_name as "decidedByName",
               p.decided_at as "decidedAt",
               p.send_count as "sendCount",
               p.received_at as "receivedAt",
               p.updated_at as "updatedAt",
               (select count(*)::int from hr_budget_spends s
                 where s.budget_external_id = p.external_id) as "spendCount",
               (select coalesce(sum(s.amount), 0)::text from hr_budget_spends s
                 where s.budget_external_id = p.external_id
                   and s.status <> 'refused') as "spentAmount",
               (select coalesce(sum(s.amount), 0)::text from hr_budget_spends s
                 where s.budget_external_id = p.external_id
                   and s.status = 'paid') as "paidAmount"
          from hr_budget_periods p
          left join users u on u.id = p.decided_by
         where ${where}
         order by p.received_at desc
         limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`),
      this.db.client.execute(
        sql`select count(*)::int as n from hr_budget_periods p where ${where}`,
      ),
    ]);
    const total = Number(
      (counted.rows as unknown as { n: number }[])[0]?.n ?? 0,
    );
    return {
      items: rows.rows as unknown as PeriodRow[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async listSpends(query: ListSpendsQuery): Promise<Paginated<SpendRow>> {
    const like = query.q ? `%${query.q}%` : null;
    const where = sql`true
      ${query.status ? sql`and s.status = ${query.status}` : sql``}
      ${query.budgetExternalId ? sql`and s.budget_external_id = ${query.budgetExternalId}::uuid` : sql``}
      ${like ? sql`and (s.purpose ilike ${like} or s.employee_name ilike ${like} or tm.full_name ilike ${like} or p.category_name ilike ${like})` : sql``}`;
    const from = sql`from hr_budget_spends s
          left join hr_budget_periods p on p.external_id = s.budget_external_id
          left join team_members tm on tm.id = s.team_member_id
          left join users u on u.id = s.decided_by
          left join transactions t on t.id = s.transaction_id`;
    const [rows, counted] = await Promise.all([
      this.db.client.execute(sql`
        select s.id::text as "id",
               s.external_id::text as "externalId",
               s.budget_external_id::text as "budgetExternalId",
               (p.id is not null) as "budgetKnown",
               s.spent_on::text as "spentOn",
               s.amount::text as "amount",
               s.purpose as "purpose",
               s.team_member_id::text as "teamMemberId",
               tm.full_name as "teamMemberName",
               s.employee_name as "employeeName",
               s.hr_status as "hrStatus",
               s.hr_approved_by_name as "hrApprovedByName",
               s.hr_approved_at as "hrApprovedAt",
               s.recorded_by_name as "recordedByName",
               s.has_receipt as "hasReceipt",
               s.status as "status",
               s.status_note as "statusNote",
               u.full_name as "decidedByName",
               s.decided_at as "decidedAt",
               s.paid_on::text as "paidOn",
               s.send_count as "sendCount",
               s.received_at as "receivedAt",
               s.updated_at as "updatedAt",
               p.category_name as "categoryName",
               p.starts_on::text as "budgetStartsOn",
               p.ends_on::text as "budgetEndsOn",
               p.status as "budgetStatus",
               s.transaction_id::text as "transactionId",
               t.ref_no as "transactionRef"
          ${from}
         where ${where}
         order by s.spent_on desc, s.received_at desc
         limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`),
      this.db.client.execute(
        sql`select count(*)::int as n ${from} where ${where}`,
      ),
    ]);
    const total = Number(
      (counted.rows as unknown as { n: number }[])[0]?.n ?? 0,
    );
    return {
      items: rows.rows as unknown as SpendRow[],
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Finance's decisions                                                */
  /* ------------------------------------------------------------------ */

  async decidePeriod(
    id: string,
    input: DecisionInput,
    actor: AuthenticatedUser,
  ) {
    const [period] = await this.db.client
      .select()
      .from(hrBudgetPeriods)
      .where(eq(hrBudgetPeriods.id, id))
      .limit(1);
    if (!period) throw new NotFoundException("That budget is not here");
    if (period.status === input.decision) {
      throw new BadRequestException(`That budget is already ${input.decision}`);
    }
    const reopening = input.decision === "received";
    await this.audit.mutate({
      action: "update",
      entityTable: "hr_budget_periods",
      entityId: id,
      module: "hr-budget",
      summary: reopening
        ? `${actor.fullName} put the budget ${period.categoryName} back to received`
        : `${actor.fullName} ${input.decision} the budget ${period.categoryName}, ${formatMoney(period.amount)}${input.note ? ` — ${input.note}` : ""}`,
      read: async (tx) =>
        (
          await tx
            .select()
            .from(hrBudgetPeriods)
            .where(eq(hrBudgetPeriods.id, id))
            .limit(1)
        )[0],
      run: async (tx) => {
        await tx
          .update(hrBudgetPeriods)
          .set({
            status: input.decision,
            statusNote: reopening ? null : input.note,
            decidedBy: reopening ? null : actor.id,
            decidedAt: reopening ? null : new Date(),
            updatedAt: new Date(),
          })
          .where(eq(hrBudgetPeriods.id, id));
      },
    });
    return (await this.periodStates([period.externalId]))[0];
  }

  async decideSpend(
    id: string,
    input: DecisionInput,
    actor: AuthenticatedUser,
  ) {
    const spend = await this.spendRow(id);
    if (spend.status === "paid") {
      throw new BadRequestException(
        "That spend is paid. Its payment is in the books — void that entry first if it was wrong.",
      );
    }
    if (spend.status === input.decision) {
      throw new BadRequestException(`That spend is already ${input.decision}`);
    }
    const reopening = input.decision === "received";
    await this.audit.mutate({
      action: "update",
      entityTable: "hr_budget_spends",
      entityId: id,
      module: "hr-budget",
      summary: reopening
        ? `${actor.fullName} put the spend "${spend.purpose}" back to received`
        : `${actor.fullName} ${input.decision} the spend "${spend.purpose}", ${formatMoney(spend.amount)}${input.note ? ` — ${input.note}` : ""}`,
      read: async (tx) =>
        (
          await tx
            .select()
            .from(hrBudgetSpends)
            .where(eq(hrBudgetSpends.id, id))
            .limit(1)
        )[0],
      run: async (tx) => {
        await tx
          .update(hrBudgetSpends)
          .set({
            status: input.decision,
            statusNote: reopening ? null : input.note,
            decidedBy: reopening ? null : actor.id,
            decidedAt: reopening ? null : new Date(),
            updatedAt: new Date(),
          })
          .where(eq(hrBudgetSpends.id, id));
      },
    });
    return (await this.spendStates([spend.externalId]))[0];
  }

  /**
   * Paying an approved spend: the expense it becomes, written through the
   * ledger's own door, then the spend marked paid on that entry's date and
   * pointed at it. The entry is written first: if marking fails, the money
   * is still recorded, which is the half that must not be lost.
   */
  async paySpend(id: string, input: PaySpendInput, actor: AuthenticatedUser) {
    const spend = await this.spendRow(id);
    if (spend.status !== "approved") {
      throw new BadRequestException(
        spend.status === "paid"
          ? "That spend is already paid."
          : "Approve the spend before paying it.",
      );
    }

    const entry = await this.transactions.create(
      {
        direction: "out",
        txnDate: input.txnDate,
        accountId: input.accountId,
        categoryId: input.categoryId,
        amount: spend.amount,
        usdRate: input.usdRate,
        paymentMethod: "bank_transfer",
        description: input.description,
        notes: input.notes ?? undefined,
        counterparty: spend.employeeName ?? undefined,
      },
      actor,
    );

    await this.audit.mutate({
      action: "pay",
      entityTable: "hr_budget_spends",
      entityId: id,
      module: "hr-budget",
      summary: `${actor.fullName} paid the spend "${spend.purpose}", ${formatMoney(spend.amount)}, as ${entry.refNo}`,
      read: async (tx) =>
        (
          await tx
            .select()
            .from(hrBudgetSpends)
            .where(eq(hrBudgetSpends.id, id))
            .limit(1)
        )[0],
      run: async (tx) => {
        await tx
          .update(hrBudgetSpends)
          .set({
            status: "paid",
            paidOn: input.txnDate,
            transactionId: entry.id,
            updatedAt: new Date(),
          })
          .where(eq(hrBudgetSpends.id, id));
      },
    });
    /* With the entry it became, so the page can file the invoice and the
       bank's slip on it (#122). */
    const [state] = await this.spendStates([spend.externalId]);
    return { ...state, transactionId: entry.id, transactionRef: entry.refNo };
  }

  private async spendRow(id: string) {
    const [spend] = await this.db.client
      .select()
      .from(hrBudgetSpends)
      .where(eq(hrBudgetSpends.id, id))
      .limit(1);
    if (!spend) throw new NotFoundException("That spend is not here");
    return spend;
  }
}
