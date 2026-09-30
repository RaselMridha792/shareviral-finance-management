import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  formatIsoDate,
  formatMoney,
  todayInDhaka,
  type Paginated,
} from "@finance/shared";
import { sql, type SQL } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { NotificationsService } from "../notifications/notifications.service";
import { applyPendingOneOffs } from "../payroll/one-offs";
import { PayrollService } from "../payroll/payroll.service";
import { TeamMembersService } from "../team-members/team-members.service";
import {
  stateOf,
  type DecisionInput,
  type ListRequestsQuery,
  type RequestKind,
  type RequestState,
  type SubmitPayChangeInput,
} from "./hr-requests.schemas";

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

/** Where each kind lives, and what the audit trail calls it. */
const TABLE: Record<RequestKind, string> = {
  pay_change: "compensation_requests",
  one_off: "payroll_one_offs",
  budget: "hr_budget_periods",
  spend: "hr_budget_spends",
};

const KIND_WORD: Record<RequestKind, string> = {
  pay_change: "pay change",
  one_off: "one-off",
  budget: "budget",
  spend: "spend",
};

/** One row of the queue, whatever its kind. */
export type RequestRow = {
  kind: RequestKind;
  id: string;
  externalId: string | null;
  /** The person, or the budget's category, or the spend's purpose. */
  subject: string;
  teamMemberId: string | null;
  amount: string;
  /** When it takes effect: a pay change's start, a one-off's month, a budget's start, a spend's day. */
  effectiveOn: string;
  /** YYYY-MM of `effectiveOn` — the month filter. */
  monthKey: string;
  /** The reason, the note, the budget's dates or who a spend was for. */
  detail: string | null;
  requestedByName: string | null;
  hrApprovedByName: string | null;
  hrApprovedAt: string | null;
  hrNote: string | null;
  /** As stored: received, held, approved, refused — and paid, for a spend. */
  status: string;
  state: RequestState;
  paid: boolean;
  note: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  beforeApprovals: boolean;
  sendCount: number;
  receivedAt: string;
};

export type RequestDetail = RequestRow & {
  /** A pay change: the figure in force before it. */
  previousAmount: string | null;
  /** The salary sheets it reaches, with where each stands. */
  sheets: { label: string; status: string }[];
  /** A spend: its budget. A budget: what has been spent against it. */
  budget: {
    categoryName: string | null;
    startsOn: string | null;
    endsOn: string | null;
    status: string | null;
    amount: string | null;
    spent: string | null;
    paid: string | null;
    spendCount: number;
  } | null;
  transactionRef: string | null;
  /** What finance, and HR, did with it — the audit trail, oldest first. */
  history: { at: string; summary: string; byName: string | null }[];
};

/** What the HR portal reads back: the same shape for all four kinds. */
export type RequestStatus = {
  externalId: string;
  state: RequestState;
  /** The CFO's own words. */
  note: string | null;
  /** A name, not an id — the HR portal cannot resolve a finance user. */
  decidedByName: string | null;
  decidedAt: string | null;
  /** When the money actually moved. */
  appliedAt: string | null;
};

export type SubmitResult = {
  outcome: "created" | "amended" | "conflict";
  state: RequestStatus;
};

/**
 * Every money request from the HR portal, and finance's answer (#125).
 *
 * The owner, 30 Sep 2026: *"jokhon taka poysar kono hisab finance a
 * pathabe ... eigula akhon HRM theke dewa matro sorasori aprove hoye jay.
 * eta kora jabena"* — and *"ekdom 1 taka theke suru kore jotoi hok, takar
 * hisebe onumodon lagbei"*. A raise, a one-off, a budget, a spend: each is
 * stored as a request and changes nothing until the CFO or the Super Admin
 * (`hrrequests.decide`) approves it. Approval is the only state that writes:
 * the salary row, the sheet's bonus, the budget. A refusal and a hold write
 * nothing, and say why in the decider's words.
 *
 * An applied approval is not taken back: a raise written into the salary
 * history, a one-off on a sheet, a spend paid — the money has moved, and a
 * correction is a new request from HR. Anything else can be put back to
 * waiting.
 *
 * Four kinds, four tables — the budget ones and one-offs predate this — and
 * one queue over them (`rowsSql`), so the page, the counts and the status HR
 * reads all say the same thing.
 */
@Injectable()
export class HrRequestsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly team: TeamMembersService,
    private readonly payroll: PayrollService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  HR's door for pay changes                                          */
  /* ------------------------------------------------------------------ */

  /**
   * A pay change from the HR portal, stored and not applied. Keyed on the HR
   * row's id: a repeat amends while it waits (or is held, which puts it back
   * to waiting); once decided, a repeat is answered with its state.
   */
  async submitPayChange(
    input: SubmitPayChangeInput,
    actor: AuthenticatedUser,
  ): Promise<SubmitResult> {
    const found = await this.db.client.execute(sql`
      select id, full_name as "fullName" from team_members
       where id = ${input.teamMemberId}::uuid and deleted_at is null`);
    const member = found.rows[0] as
      { id: string; fullName: string } | undefined;
    if (!member) throw new NotFoundException("No such team member");

    const written = await this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        insert into compensation_requests (
          external_id, team_member_id, gross_amount, effective_from,
          change_reason, hr_note, requested_by_name, hr_approved_by_name,
          hr_approved_at)
        values (
          ${input.externalId}::uuid, ${input.teamMemberId}::uuid,
          ${input.grossAmount}::numeric, ${input.effectiveFrom}::date,
          ${input.changeReason ?? null}, ${input.hrNote ?? null},
          ${input.requestedByName}, ${input.hrApprovedByName ?? null},
          ${input.hrApprovedAt ?? null}::timestamptz)
        on conflict (external_id) do update set
          team_member_id = excluded.team_member_id,
          gross_amount = excluded.gross_amount,
          effective_from = excluded.effective_from,
          change_reason = excluded.change_reason,
          hr_note = excluded.hr_note,
          requested_by_name = excluded.requested_by_name,
          hr_approved_by_name = excluded.hr_approved_by_name,
          hr_approved_at = excluded.hr_approved_at,
          status = 'received', status_note = null,
          decided_by = null, decided_at = null,
          send_count = compensation_requests.send_count + 1,
          updated_at = now()
        where compensation_requests.status in ('received', 'held')
        returning id::text, (xmax = 0) as inserted`);
      const row = result.rows[0] as
        { id: string; inserted: boolean } | undefined;
      if (!row) return null;
      await this.audit.record(tx, {
        action: row.inserted ? "create" : "update",
        entityTable: TABLE.pay_change,
        entityId: row.id,
        module: "hr-requests",
        isSensitive: true,
        summary: `${actor.fullName} ${row.inserted ? "asked" : "asked again"} for ${member.fullName}'s pay to be ${formatMoney(input.grossAmount)} from ${formatIsoDate(input.effectiveFrom)}, for ${input.requestedByName} — waiting for a decision`,
        after: input,
      });
      return row;
    });

    if (written?.inserted) {
      await this.notifications.ringHrRequest({
        kind: "pay_change",
        id: written.id,
        title: `HR asks to change ${member.fullName}'s pay`,
        body: `To ${formatMoney(input.grossAmount, { currency: "BDT" })} from ${formatIsoDate(input.effectiveFrom)}, from ${input.requestedByName}. Waiting for a decision.`,
      });
    }

    const [state] = await this.statuses("pay_change", [input.externalId]);
    return {
      outcome: !written ? "conflict" : written.inserted ? "created" : "amended",
      state,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  What HR reads back                                                 */
  /* ------------------------------------------------------------------ */

  /** The ones named that are here, in one shape; the rest are left out. */
  async statuses(
    kind: RequestKind,
    externalIds: string[],
  ): Promise<RequestStatus[]> {
    if (externalIds.length === 0) return [];
    const ids = sql.join(
      externalIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const result = await this.db.client.execute(sql`
      select r.external_id::text as "externalId", r.status,
             r.status_note as "note", u.full_name as "decidedByName",
             r.decided_at as "decidedAt", r.applied_at as "appliedAt",
             r.before_approvals as "beforeApprovals"
        from (${this.rowsSql()}) r
        left join users u on u.id = r.decided_by
       where r.kind = ${kind} and r.external_id in (${ids})`);
    return (
      result.rows as unknown as (Omit<RequestStatus, "state"> & {
        status: string;
        decidedAt: Date | string | null;
        appliedAt: Date | string | null;
      })[]
    ).map(({ status, decidedAt, appliedAt, ...row }) => ({
      externalId: row.externalId,
      state: stateOf(status),
      note: row.note,
      decidedByName: row.decidedByName,
      decidedAt: iso(decidedAt),
      appliedAt: iso(appliedAt),
    }));
  }

  /* ------------------------------------------------------------------ */
  /*  The page                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * The four kinds as one relation: a row per request, the same columns.
   * A spend that is paid reads as approved, and its payment day as the day
   * the money moved.
   */
  private rowsSql(): SQL {
    return sql`
      select 'pay_change'::text as kind, c.id, c.external_id,
             m.full_name::text as subject, c.team_member_id,
             c.gross_amount as amount, c.effective_from as effective_on,
             c.change_reason::text as detail,
             c.requested_by_name::text as requested_by_name,
             c.hr_approved_by_name::text as hr_approved_by_name,
             c.hr_approved_at, c.hr_note::text as hr_note,
             c.status::text as status, c.status_note::text as status_note,
             c.decided_by, c.decided_at, c.applied_at,
             c.before_approvals, c.send_count, c.received_at,
             false as paid
        from compensation_requests c
        join team_members m on m.id = c.team_member_id
      union all
      select 'one_off', o.id, o.external_id, m.full_name::text,
             o.team_member_id, o.amount,
             make_date(o.period_year, o.period_month, 1), o.note::text,
             null::text, null::text, null::timestamptz, null::text,
             o.status::text, o.status_note::text, o.decided_by, o.decided_at,
             o.applied_at, o.before_approvals, o.send_count, o.received_at,
             false
        from payroll_one_offs o
        join team_members m on m.id = o.team_member_id
      union all
      select 'budget', p.id, p.external_id, p.category_name::text, null::uuid,
             p.amount, p.starts_on,
             to_char(p.starts_on, 'DD/MM/YYYY') || ' to '
               || to_char(p.ends_on, 'DD/MM/YYYY'),
             p.recorded_by_name::text, null::text, null::timestamptz,
             p.note::text, p.status::text, p.status_note::text, p.decided_by,
             p.decided_at, null::timestamptz, false, p.send_count,
             p.received_at, false
        from hr_budget_periods p
      union all
      select 'spend', s.id, s.external_id, s.purpose::text, s.team_member_id,
             s.amount, s.spent_on, s.employee_name::text,
             s.recorded_by_name::text, s.hr_approved_by_name::text,
             s.hr_approved_at, null::text,
             case when s.status = 'paid' then 'approved' else s.status::text end,
             s.status_note::text, s.decided_by, s.decided_at,
             case when s.paid_on is not null
                  then (s.paid_on::timestamp at time zone 'Asia/Dhaka') end,
             false, s.send_count, s.received_at, s.status = 'paid'
        from hr_budget_spends s`;
  }

  private select(where: SQL): SQL {
    return sql`
      select r.kind, r.id::text as "id", r.external_id::text as "externalId",
             r.subject, r.team_member_id::text as "teamMemberId",
             r.amount::text as "amount",
             r.effective_on::text as "effectiveOn",
             to_char(r.effective_on, 'YYYY-MM') as "monthKey",
             r.detail, r.requested_by_name as "requestedByName",
             r.hr_approved_by_name as "hrApprovedByName",
             r.hr_approved_at as "hrApprovedAt", r.hr_note as "hrNote",
             r.status, r.paid, r.status_note as "note",
             u.full_name as "decidedByName", r.decided_at as "decidedAt",
             r.applied_at as "appliedAt",
             r.before_approvals as "beforeApprovals",
             r.send_count as "sendCount", r.received_at as "receivedAt"
        from (${this.rowsSql()}) r
        left join users u on u.id = r.decided_by
       where ${where}`;
  }

  private shape(row: Record<string, unknown>): RequestRow {
    const status = String(row.status);
    return {
      ...(row as unknown as RequestRow),
      state: stateOf(status),
      hrApprovedAt: iso(row.hrApprovedAt as Date | null),
      decidedAt: iso(row.decidedAt as Date | null),
      appliedAt: iso(row.appliedAt as Date | null),
      receivedAt: iso(row.receivedAt as Date) as string,
    };
  }

  async list(query: ListRequestsQuery): Promise<
    Paginated<RequestRow> & {
      counts: {
        waiting: number;
        approved: number;
        rejected: number;
        all: number;
      };
    }
  > {
    const scope = sql.join(
      [
        sql`true`,
        query.kind ? sql`r.kind = ${query.kind}` : sql`true`,
        query.month
          ? sql`to_char(r.effective_on, 'YYYY-MM') = ${query.month}`
          : sql`true`,
        query.q
          ? sql`(r.subject ilike ${`%${query.q}%`}
                 or r.detail ilike ${`%${query.q}%`}
                 or r.requested_by_name ilike ${`%${query.q}%`})`
          : sql`true`,
      ],
      sql` and `,
    );
    const states: Record<ListRequestsQuery["state"], SQL> = {
      waiting: sql`r.status in ('received', 'held')`,
      pending: sql`r.status = 'received'`,
      held: sql`r.status = 'held'`,
      approved: sql`r.status = 'approved'`,
      rejected: sql`r.status = 'refused'`,
      all: sql`true`,
    };
    const where = sql`${scope} and ${states[query.state]}`;
    /* Waiting first — the oldest waiting at the top, since it has waited
       longest; everything decided after it, newest first. */
    const order =
      query.state === "waiting" ||
      query.state === "pending" ||
      query.state === "held"
        ? sql`order by r.received_at asc`
        : sql`order by r.received_at desc`;

    const [rows, counted] = await Promise.all([
      this.db.client.execute(sql`${this.select(where)} ${order}
        limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`),
      this.db.client.execute(sql`
        select count(*) filter (where r.status in ('received', 'held'))::int as waiting,
               count(*) filter (where r.status = 'approved')::int as approved,
               count(*) filter (where r.status = 'refused')::int as rejected,
               count(*)::int as "all",
               count(*) filter (where ${states[query.state]})::int as total
          from (${this.rowsSql()}) r
         where ${scope}`),
    ]);
    const counts = counted.rows[0] as {
      waiting: number;
      approved: number;
      rejected: number;
      all: number;
      total: number;
    };
    return {
      items: rows.rows.map((row) => this.shape(row)),
      page: query.page,
      pageSize: query.pageSize,
      total: counts.total,
      totalPages: Math.max(1, Math.ceil(counts.total / query.pageSize)),
      counts: {
        waiting: counts.waiting,
        approved: counts.approved,
        rejected: counts.rejected,
        all: counts.all,
      },
    };
  }

  /** How many wait for a decision — the count on the rail. */
  async waitingCount(): Promise<{ waiting: number }> {
    const result = await this.db.client.execute(sql`
      select count(*)::int as waiting from (${this.rowsSql()}) r
       where r.status in ('received', 'held')`);
    return result.rows[0] as { waiting: number };
  }

  async get(kind: RequestKind, id: string): Promise<RequestDetail> {
    const found = await this.db.client.execute(
      this.select(sql`r.kind = ${kind} and r.id = ${id}::uuid`),
    );
    const raw = found.rows[0] as Record<string, unknown> | undefined;
    if (!raw) throw new NotFoundException("That request is not here");
    const row = this.shape(raw);

    let previousAmount: string | null = null;
    let sheets: RequestDetail["sheets"] = [];
    let budget: RequestDetail["budget"] = null;
    let transactionRef: string | null = null;

    if (kind === "pay_change" && row.teamMemberId) {
      const before = await this.db.client.execute(sql`
        select gross_amount::text as amount from compensation_history
         where team_member_id = ${row.teamMemberId}::uuid
           and deleted_at is null
           and effective_from < ${row.effectiveOn}::date
         order by effective_from desc limit 1`);
      previousAmount =
        (before.rows[0] as { amount: string } | undefined)?.amount ?? null;
    }
    if (kind === "pay_change" || kind === "one_off") {
      const reached = await this.db.client.execute(sql`
        select label, status::text as status from payroll_runs
         where deleted_at is null
           and make_date(period_year, period_month, 1)
               ${kind === "pay_change" ? sql`>=` : sql`=`}
               date_trunc('month', ${row.effectiveOn}::date)::date
         order by period_year, period_month`);
      sheets = reached.rows as RequestDetail["sheets"];
    }
    if (kind === "spend" || kind === "budget") {
      const got = await this.db.client.execute(
        kind === "spend"
          ? sql`
            select p.category_name as "categoryName",
                   p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
                   p.status, p.amount::text as amount,
                   null as spent, null as paid, 0 as "spendCount",
                   (select t.ref_no from hr_budget_spends s
                      join transactions t on t.id = s.transaction_id
                     where s.id = ${id}::uuid) as "transactionRef"
              from hr_budget_spends s
              left join hr_budget_periods p
                on p.external_id = s.budget_external_id
             where s.id = ${id}::uuid`
          : sql`
            select p.category_name as "categoryName",
                   p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
                   p.status, p.amount::text as amount,
                   coalesce(sum(s.amount) filter (where s.status <> 'refused'), 0)::text as spent,
                   coalesce(sum(s.amount) filter (where s.status = 'paid'), 0)::text as paid,
                   count(s.id)::int as "spendCount", null as "transactionRef"
              from hr_budget_periods p
              left join hr_budget_spends s
                on s.budget_external_id = p.external_id
             where p.id = ${id}::uuid
             group by p.id`,
      );
      const one = got.rows[0] as
        | (NonNullable<RequestDetail["budget"]> & {
            transactionRef: string | null;
          })
        | undefined;
      if (one) {
        const { transactionRef: ref, ...rest } = one;
        transactionRef = ref;
        budget = rest.categoryName === null && kind === "spend" ? null : rest;
      }
    }

    const trail = await this.db.client.execute(sql`
      select a.occurred_at as at, a.summary, u.full_name as "byName"
        from audit_logs a
        left join users u on u.id = a.actor_user_id
       where a.entity_table = ${TABLE[kind]} and a.entity_id = ${id}
       order by a.occurred_at asc, a.id asc`);
    const history = (
      trail.rows as { at: Date; summary: string; byName: string | null }[]
    ).map((entry) => ({ ...entry, at: iso(entry.at) as string }));

    return {
      ...row,
      previousAmount,
      sheets,
      budget,
      transactionRef,
      history,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Deciding                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Approve, refuse, hold, or put back to waiting. Only an approval writes
   * anything; an applied approval is final. Answers with the request as it
   * now stands and, where there is one, a sentence the CFO should read — a
   * sheet already built, or already paid, at the old figure.
   */
  async decide(
    kind: RequestKind,
    id: string,
    input: DecisionInput,
    actor: AuthenticatedUser,
  ): Promise<{ request: RequestDetail; notice: string | null }> {
    const before = await this.get(kind, id);
    const from = before.status;
    const to = input.decision;
    const note = input.note?.trim() || null;

    if (from === "paid") {
      throw new ConflictException(
        "This spend is paid — the money has moved, and there is nothing left to decide.",
      );
    }
    if (from === "approved" && this.applied(before)) {
      throw new ConflictException(
        `This ${KIND_WORD[kind]} was approved and applied${before.appliedAt ? ` on ${formatIsoDate(todayInDhaka(new Date(before.appliedAt)))}` : ""} — the money has moved, so it cannot be taken back. A correction is a new request from HR.`,
      );
    }
    if (from === to && to !== "held") {
      throw new BadRequestException(
        to === "received"
          ? "It is already waiting."
          : `It is already ${to === "refused" ? "rejected" : to}.`,
      );
    }

    let notice: string | null = null;
    if (kind === "pay_change" && to === "approved") {
      notice = await this.approvePayChange(before, note, actor);
    } else {
      notice = await this.db.transaction(async (tx) => {
        await this.setStatus(tx, kind, id, from, to, note, actor);
        let said: string | null = null;
        if (kind === "one_off" && to === "approved") {
          said = await this.putOneOffOnSheet(tx, before);
        }
        await this.audit.record(tx, {
          action: "update",
          entityTable: TABLE[kind],
          entityId: id,
          module: "hr-requests",
          isSensitive: kind === "pay_change" || kind === "one_off",
          summary: this.decisionSummary(before, to, note, actor),
        });
        return said;
      });
    }

    return { request: await this.get(kind, id), notice };
  }

  /** Whether an approval has moved money that cannot be called back. */
  private applied(request: RequestDetail): boolean {
    if (request.kind === "pay_change") return true;
    if (request.kind === "one_off") return request.appliedAt !== null;
    if (request.kind === "spend") return request.paid;
    return false;
  }

  /**
   * The status change itself, guarded on the status it was read in: two
   * people deciding the same request at once, the second is told rather
   * than written over.
   */
  private async setStatus(
    tx: DbTransaction,
    kind: RequestKind,
    id: string,
    from: string,
    to: DecisionInput["decision"],
    note: string | null,
    actor: AuthenticatedUser,
  ) {
    const table = sql.raw(TABLE[kind]);
    const waiting = to === "received";
    const result = await tx.execute(sql`
      update ${table} set
        status = ${to},
        status_note = ${waiting ? null : note},
        decided_by = ${waiting ? null : actor.id}::uuid,
        decided_at = ${waiting ? sql`null` : sql`now()`},
        updated_at = now()
       where id = ${id}::uuid and status = ${from}
       returning id`);
    if (result.rows.length === 0) {
      throw new ConflictException(
        "Somebody decided this a moment ago. Open it again to see what they did.",
      );
    }
  }

  /**
   * The salary is written by the one door that writes salaries —
   * `TeamMembersService.setCompensation`, with its own audit row — and the
   * request is marked approved first, so a second approver finds it
   * decided. If writing the salary fails, the request goes back to how it
   * was.
   */
  private async approvePayChange(
    request: RequestDetail,
    note: string | null,
    actor: AuthenticatedUser,
  ): Promise<string | null> {
    await this.db.transaction(async (tx) => {
      await this.setStatus(
        tx,
        "pay_change",
        request.id,
        request.status,
        "approved",
        note,
        actor,
      );
    });

    let compensationId: string;
    try {
      const written = await this.team.setCompensation(
        request.teamMemberId as string,
        {
          grossAmount: request.amount,
          effectiveFrom: request.effectiveOn,
          changeReason:
            request.detail?.slice(0, 200) ||
            `Approved from HR's request (${request.requestedByName ?? "HR"})`,
        },
        actor,
      );
      compensationId = (written as { id: string }).id;
    } catch (error) {
      await this.db.client.execute(sql`
        update compensation_requests set
          status = ${request.status}, status_note = ${request.note},
          decided_by = null, decided_at = null, updated_at = now()
         where id = ${request.id}::uuid`);
      throw error;
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        update compensation_requests set
          compensation_id = ${compensationId}::uuid, applied_at = now(),
          updated_at = now()
         where id = ${request.id}::uuid`);
      await this.audit.record(tx, {
        action: "update",
        entityTable: TABLE.pay_change,
        entityId: request.id,
        module: "hr-requests",
        isSensitive: true,
        summary: this.decisionSummary(request, "approved", note, actor),
      });
    });

    /* The sheets it reaches that were built — or paid — before it was. */
    const built = request.sheets.filter((sheet) => sheet.status === "draft");
    const settled = request.sheets.filter((sheet) => sheet.status !== "draft");
    const said: string[] = [];
    if (built.length) {
      said.push(
        `${built.map((sheet) => sheet.label).join(", ")} ${built.length === 1 ? "was" : "were"} built at the old figure — press Build list on ${built.length === 1 ? "it" : "each"} to use the new one.`,
      );
    }
    if (settled.length) {
      said.push(
        `${settled.map((sheet) => sheet.label).join(", ")} ${settled.length === 1 ? "is" : "are"} already finalised or paid at the old figure; the difference is not paid unless HR sends it as a one-off.`,
      );
    }
    return said.length ? said.join(" ") : null;
  }

  /**
   * An approved one-off goes on its month's sheet at once when that sheet
   * is a draft with the person on it, and otherwise waits for the sheet to
   * be built. A month already finalised or paid cannot take it.
   */
  private async putOneOffOnSheet(
    tx: DbTransaction,
    request: RequestDetail,
  ): Promise<string> {
    const [year, month] = request.effectiveOn.split("-").map(Number);
    const label = `${MONTHS[month - 1]} ${year}`;
    const found = await tx.execute(sql`
      select id::text, status::text, period_year as "periodYear",
             period_month as "periodMonth"
        from payroll_runs
       where period_year = ${year} and period_month = ${month}
         and deleted_at is null
       limit 1`);
    const run = found.rows[0] as
      | { id: string; status: string; periodYear: number; periodMonth: number }
      | undefined;
    if (!run) return `It goes on the ${label} sheet when that sheet is built.`;
    if (run.status !== "draft") {
      throw new ConflictException(
        `The ${label} sheet is already ${run.status.replace(/_/g, " ")}, so this cannot go on it. Reopen the sheet first, or refuse this and ask HR to send it for another month.`,
      );
    }
    const added = await applyPendingOneOffs(tx, run);
    if (added === 0) {
      return `${request.subject} is not on the ${label} sheet yet; it goes on when they are added.`;
    }
    await this.payroll.recalculateTotals(tx, run.id);
    return `Added to ${request.subject}'s bonus on the ${label} sheet.`;
  }

  private decisionSummary(
    request: RequestRow,
    to: DecisionInput["decision"],
    note: string | null,
    actor: AuthenticatedUser,
  ): string {
    const verb = {
      approved: "approved",
      refused: "rejected",
      held: "put on hold",
      received: "put back to waiting",
    }[to];
    const what =
      request.kind === "pay_change"
        ? `${request.subject}'s pay change to ${formatMoney(request.amount)} from ${formatIsoDate(request.effectiveOn)}`
        : request.kind === "one_off"
          ? `a one-off of ${formatMoney(request.amount)} for ${request.subject}`
          : request.kind === "budget"
            ? `the budget ${request.subject}, ${formatMoney(request.amount)}`
            : `the spend "${request.subject}", ${formatMoney(request.amount)}`;
    return `${actor.fullName} ${verb} ${what}${note ? `: ${note}` : ""}`;
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
