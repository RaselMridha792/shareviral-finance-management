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
  toMinorUnits,
  type Paginated,
} from "@finance/shared";
import { sql, type SQL } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { HrWebhookService } from "../hr-webhook/hr-webhook.service";
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
import { sheetNotice, type ReachedSheet } from "./sheet-notice";
import {
  iso,
  readStatuses,
  requestRowsSql,
  type RequestStatus,
} from "./request-rows";

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
  /**
   * A pay change: the figure on file FOR its date and the day that figure
   * starts, the one in force today, and the next change on file after its
   * date — which is where an approved figure stops applying. The HR portal
   * re-sends old revisions when the two apps disagree (its Brief 7 §6), and
   * these are what tell the CFO it is a correction rather than a raise
   * (#128).
   */
  onFileAmount: string | null;
  onFileFrom: string | null;
  currentAmount: string | null;
  nextChangeOn: string | null;
  /** The salary sheets it reaches, with where each stands. */
  sheets: ReachedSheet[];
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

export type { RequestStatus } from "./request-rows";

export type SubmitResult = {
  outcome: "created" | "amended" | "conflict";
  state: RequestStatus;
};

export type WithdrawResult = {
  /** withdrawn now · unchanged: it already was · conflict: decided first. */
  outcome: "withdrawn" | "unchanged" | "conflict";
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
    private readonly webhook: HrWebhookService,
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

  /**
   * HR takes back a request that still waits (#126): its revision was
   * cancelled or deleted in the HR portal. The row stays — the CFO's queue
   * does not silently lose entries — marked withdrawn, off the waiting list,
   * and no longer holding up a salary sheet. Nobody in finance decided it,
   * so `decided_by` stays null; `decided_at` is when it was withdrawn.
   *
   * Only while it waits or is held. Once decided it is answered with its
   * state: an approval may have moved money already, and a refusal already
   * says no.
   */
  async withdraw(
    kind: RequestKind,
    externalId: string,
    note: string | null,
    actor: AuthenticatedUser,
  ): Promise<WithdrawResult> {
    const table = sql.raw(TABLE[kind]);
    const outcome = await this.db.transaction(async (tx) => {
      const found = await tx.execute(sql`
        select id::text, status from ${table}
         where external_id = ${externalId}::uuid
         for update`);
      const row = found.rows[0] as { id: string; status: string } | undefined;
      if (!row) throw new NotFoundException("No request with that id");
      if (row.status === "withdrawn") return "unchanged" as const;
      if (row.status !== "received" && row.status !== "held") {
        return "conflict" as const;
      }
      await tx.execute(sql`
        update ${table} set
          status = 'withdrawn', status_note = ${note},
          decided_by = null, decided_at = now(), updated_at = now()
         where id = ${row.id}::uuid`);
      await this.audit.record(tx, {
        action: "update",
        entityTable: TABLE[kind],
        entityId: row.id,
        module: "hr-requests",
        isSensitive: kind === "pay_change" || kind === "one_off",
        summary: `${actor.fullName} withdrew the ${KIND_WORD[kind]} for HR${note ? `: ${note}` : ""}`,
      });
      return "withdrawn" as const;
    });
    const [state] = await this.statuses(kind, [externalId]);
    return { outcome, state };
  }

  /* ------------------------------------------------------------------ */
  /*  What HR reads back                                                 */
  /* ------------------------------------------------------------------ */

  /** The ones named that are here, in one shape; the rest are left out. */
  async statuses(
    kind: RequestKind,
    externalIds: string[],
  ): Promise<RequestStatus[]> {
    return readStatuses(this.db.client, kind, externalIds);
  }

  /* ------------------------------------------------------------------ */
  /*  The page                                                           */
  /* ------------------------------------------------------------------ */

  /** The four kinds as one relation — `request-rows.ts`. */
  private rowsSql(): SQL {
    return requestRowsSql();
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
        withdrawn: number;
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
      withdrawn: sql`r.status = 'withdrawn'`,
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
               count(*) filter (where r.status = 'withdrawn')::int as withdrawn,
               count(*)::int as "all",
               count(*) filter (where ${states[query.state]})::int as total
          from (${this.rowsSql()}) r
         where ${scope}`),
    ]);
    const counts = counted.rows[0] as {
      waiting: number;
      approved: number;
      rejected: number;
      withdrawn: number;
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
        withdrawn: counts.withdrawn,
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
    let onFileAmount: string | null = null;
    let onFileFrom: string | null = null;
    let currentAmount: string | null = null;
    let nextChangeOn: string | null = null;
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
      const onFile = await this.onFileFor(row.teamMemberId, row.effectiveOn);
      onFileAmount = onFile?.amount ?? null;
      onFileFrom = onFile?.from ?? null;
      const figures = await this.db.client.execute(sql`
        select
          (select gross_amount::text from compensation_history
            where team_member_id = ${row.teamMemberId}::uuid
              and deleted_at is null
              and effective_from <= (now() at time zone 'Asia/Dhaka')::date
            order by effective_from desc limit 1) as "current",
          (select min(effective_from)::text from compensation_history
            where team_member_id = ${row.teamMemberId}::uuid
              and deleted_at is null
              and effective_from > ${row.effectiveOn}::date) as "nextOn"`);
      const got = figures.rows[0] as
        { current: string | null; nextOn: string | null } | undefined;
      currentAmount = got?.current ?? null;
      nextChangeOn = got?.nextOn ?? null;
    }
    if (kind === "pay_change" || kind === "one_off") {
      /* A pay change reaches the months from its own until the next change
         on file: payroll takes the latest figure starting on or before a
         month's end, so from the next change's month on, that one applies
         and this does not. */
      /* With what each sheet holds for the person: a built line keeps the
         figure it was built with (`sheetNotice`). */
      const reached = await this.db.client.execute(sql`
        select r.label, r.status::text as status,
               l.gross_amount::text as gross,
               l.working_days as "workingDays"
          from payroll_runs r
          left join payroll_lines l
            on l.payroll_run_id = r.id
           and l.team_member_id = ${row.teamMemberId}::uuid
         where r.deleted_at is null
           and make_date(r.period_year, r.period_month, 1)
               ${kind === "pay_change" ? sql`>=` : sql`=`}
               date_trunc('month', ${row.effectiveOn}::date)::date
           ${
             kind === "pay_change" && nextChangeOn
               ? sql`and (make_date(r.period_year, r.period_month, 1)
                          + interval '1 month' - interval '1 day')::date
                         < ${nextChangeOn}::date`
               : sql``
           }
         order by r.period_year, r.period_month`);
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
      onFileAmount,
      onFileFrom,
      currentAmount,
      nextChangeOn,
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
   * sheet already built, or already paid, at another figure, or pay that
   * does not change at all.
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

    if (from === "withdrawn") {
      throw new ConflictException(
        "HR withdrew this request, so there is nothing to decide. If it is wanted after all, HR sends it again.",
      );
    }
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
    /* One-offs this approval put on a sheet — the one decided, and any other
       approved one waiting for the same month and line. */
    let alsoApplied: string[] = [];
    if (kind === "pay_change" && to === "approved") {
      notice = await this.approvePayChange(before, note, actor);
    } else {
      notice = await this.db.transaction(async (tx) => {
        await this.setStatus(
          tx,
          kind,
          id,
          from,
          before.sendCount,
          to,
          note,
          actor,
        );
        let said: string | null = null;
        if (kind === "one_off" && to === "approved") {
          const put = await this.putOneOffOnSheet(tx, before);
          said = put.said;
          alsoApplied = put.applied;
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

    /* Committed: the HR portal hears it now rather than at its next poll
       (#128). A row copied in from before approvals has no id, and is
       skipped — HR never sent it. */
    this.webhook.notify(kind, [before.externalId, ...alsoApplied]);

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
  /**
   * Moves a request from the state it was read in — and only as it was read:
   * HR's re-send keeps a waiting request waiting but changes what it asks
   * for, and always moves its send count, so a re-send landing between the
   * read and this update is refused rather than decided unseen.
   */
  private async setStatus(
    tx: DbTransaction,
    kind: RequestKind,
    id: string,
    from: string,
    sendCount: number,
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
         and send_count = ${sendCount}
       returning id`);
    if (result.rows.length === 0) {
      throw new ConflictException(
        "Somebody decided this a moment ago, or HR sent it again. Open it again to see where it stands.",
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
        request.sendCount,
        "approved",
        note,
        actor,
      );
    });

    /*
     * The figure already on file for that date, read now rather than when
     * the pop-up was drawn, and inside the `try`: if it fails, the approval
     * is undone like any other failure here, never left approved with no
     * salary behind it.
     *
     * When a row starts ON that date with this same figure, the salary
     * record is left exactly as it is (#128): rewriting it would change
     * nothing anybody is paid, yet it would stamp the row with this request's
     * reason and approver — and a joining-salary row stamped so stops
     * following a corrected joining salary from HR (`followJoiningSalary`).
     *
     * Only on that date. The same figure on file from an EARLIER date is
     * still written as a row of its own: it pays nothing different now, but
     * it is what keeps this revision's figure when the earlier row is later
     * corrected — skip it, and the order two requests are approved in would
     * decide what somebody is paid.
     */
    let onFile: { id: string; amount: string; from: string } | null = null;
    let unchanged = false;

    let compensationId: string;
    try {
      onFile = await this.onFileFor(
        request.teamMemberId as string,
        request.effectiveOn,
      );
      unchanged =
        onFile !== null &&
        onFile.from === request.effectiveOn &&
        toMinorUnits(onFile.amount) === toMinorUnits(request.amount);
      if (unchanged && onFile) {
        compensationId = onFile.id;
      } else {
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
      }
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
        /* What the salary was, said once and kept: after a same-date
           correction the row it overwrote is gone, and without this line
           the history would read the correction as a raise. */
        summary: this.decisionSummary(
          request,
          "approved",
          note,
          actor,
          !onFile
            ? " — no salary was on file for that date"
            : unchanged
              ? " — the same figure was already on file from that date, so the salary record was left as it was"
              : onFile.from === request.effectiveOn
                ? ` — replacing ${formatMoney(onFile.amount)} that was on file from that date`
                : ` — was ${formatMoney(onFile.amount)} from ${formatIsoDate(onFile.from)}`,
        ),
      });
    });

    /* What the sheets it reaches hold for them, where that is not this
       figure — even when the record does not move, a sheet built before it
       did still holds what it was built with. */
    const sheets = sheetNotice(request.sheets, request.amount);
    const andSheets = (said: string) => (sheets ? `${said} ${sheets}` : said);

    if (unchanged) {
      return andSheets(
        "The salary on file for that date was already this figure, so the salary record was left as it was.",
      );
    }
    /* The same figure from an earlier date: written above as a row of its
       own, but the record's figure for those months does not move. */
    if (
      onFile &&
      toMinorUnits(onFile.amount) === toMinorUnits(request.amount)
    ) {
      return andSheets(
        `Pay does not change: the same figure was already on file from ${formatIsoDate(onFile.from)}. It is kept as a salary record of its own from ${formatIsoDate(request.effectiveOn)}.`,
      );
    }
    /* A later change starting in the same month decides that month — a
       sheet takes the figure in force at the month's end — and every month
       after it, so this figure reaches no sheet at all. */
    if (
      request.nextChangeOn &&
      request.nextChangeOn.slice(0, 7) === request.effectiveOn.slice(0, 7)
    ) {
      return `Pay does not change: the later change on file from ${formatIsoDate(request.nextChangeOn)} starts in the same month, and a salary sheet takes the figure in force at the month's end, so this figure reaches no sheet. It is kept on the salary record from ${formatIsoDate(request.effectiveOn)}.`;
    }

    return sheets;
  }

  /**
   * An approved one-off goes on its month's sheet at once when that sheet
   * is a draft with the person on it, and otherwise waits for the sheet to
   * be built. A month already finalised or paid cannot take it.
   */
  private async putOneOffOnSheet(
    tx: DbTransaction,
    request: RequestDetail,
  ): Promise<{ said: string; applied: string[] }> {
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
    if (!run) {
      return {
        said: `It goes on the ${label} sheet when that sheet is built.`,
        applied: [],
      };
    }
    if (run.status !== "draft") {
      throw new ConflictException(
        `The ${label} sheet is already ${run.status.replace(/_/g, " ")}, so this cannot go on it. Reopen the sheet first, or refuse this and ask HR to send it for another month.`,
      );
    }
    const added = await applyPendingOneOffs(tx, run);
    if (added.length === 0) {
      return {
        said: `${request.subject} is not on the ${label} sheet yet; it goes on when they are added.`,
        applied: [],
      };
    }
    await this.payroll.recalculateTotals(tx, run.id);
    return {
      said: `Added to ${request.subject}'s bonus on the ${label} sheet.`,
      applied: added,
    };
  }

  private decisionSummary(
    request: RequestRow,
    to: DecisionInput["decision"],
    note: string | null,
    actor: AuthenticatedUser,
    /** Said after what was decided: for a pay change, what the salary was. */
    extra = "",
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
    return `${actor.fullName} ${verb} ${what}${extra}${note ? `: ${note}` : ""}`;
  }

  /**
   * The salary row in force on a date — the latest one starting on or
   * before it, not in the trash — or null when nothing is on file yet.
   */
  private async onFileFor(
    teamMemberId: string,
    on: string,
  ): Promise<{ id: string; amount: string; from: string } | null> {
    const found = await this.db.client.execute(sql`
      select id::text, gross_amount::text as amount,
             effective_from::text as "from"
        from compensation_history
       where team_member_id = ${teamMemberId}::uuid
         and deleted_at is null
         and effective_from <= ${on}::date
       order by effective_from desc
       limit 1`);
    return (
      (found.rows[0] as { id: string; amount: string; from: string }) ?? null
    );
  }
}
