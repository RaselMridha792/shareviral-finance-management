import { sql, type SQL } from "drizzle-orm";

import type { DbTransaction } from "../../db";
import type { DbService } from "../../db/db.service";
import {
  stateOf,
  type RequestKind,
  type RequestState,
} from "./hr-requests.schemas";

/** What the HR portal reads back: the same shape for all four kinds. */
export type RequestStatus = {
  externalId: string;
  state: RequestState;
  /** The CFO's own words (or, withdrawn, HR's reason). */
  note: string | null;
  /** A name, not an id — the HR portal cannot resolve a finance user. */
  decidedByName: string | null;
  decidedAt: string | null;
  /** When the money actually moved. */
  appliedAt: string | null;
};

/**
 * The four kinds of HR money request as one relation (#125): a row per
 * request, the same columns. A spend that is paid reads as approved, and its
 * payment day — midnight in Dhaka — as when the money moved.
 *
 * One definition for every reader: the page, the status routes the HR portal
 * polls, and the webhook that tells it at once (#128). If the three read it
 * three ways, the HR portal would hear one thing by poll and another by
 * webhook about the same request.
 */
export function requestRowsSql(): SQL {
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

/**
 * The state of each request named, in the shape the HR portal reads. Ids that
 * are not here are left out rather than answered as errors — that is how the
 * HR portal reads "never sent" off the gap. A row copied in from before
 * approvals existed has no external id and so is never named.
 */
export async function readStatuses(
  client: DbTransaction | DbService["client"],
  kind: RequestKind,
  externalIds: string[],
): Promise<RequestStatus[]> {
  if (externalIds.length === 0) return [];
  const ids = sql.join(
    externalIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await client.execute(sql`
    select r.external_id::text as "externalId", r.status,
           r.status_note as "note", u.full_name as "decidedByName",
           r.decided_at as "decidedAt", r.applied_at as "appliedAt"
      from (${requestRowsSql()}) r
      left join users u on u.id = r.decided_by
     where r.kind = ${kind} and r.external_id in (${ids})`);
  return (
    result.rows as unknown as {
      externalId: string;
      status: string;
      note: string | null;
      decidedByName: string | null;
      decidedAt: Date | string | null;
      appliedAt: Date | string | null;
    }[]
  ).map((row) => ({
    externalId: row.externalId,
    state: stateOf(row.status),
    note: row.note,
    decidedByName: row.decidedByName,
    decidedAt: iso(row.decidedAt),
    appliedAt: iso(row.appliedAt),
  }));
}

/** A timestamp as ISO 8601 in UTC, or null. */
export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
