import { ConflictException } from "@nestjs/common";
import { formatIsoDate, formatMoney } from "@finance/shared";
import { sql } from "drizzle-orm";

import type { DbTransaction } from "../../db";
import type { DbService } from "../../db/db.service";

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

export type BlockingRequest = {
  kind: "pay_change" | "one_off";
  id: string;
  teamMemberName: string;
  amount: string;
  /** A pay change's start, or a one-off's month (its first day). */
  effectiveOn: string;
  status: "received" | "held";
};

/**
 * The money requests from HR that a month's salary sheet cannot be built or
 * finalised around (#125).
 *
 * The owner, 30 Sep 2026: *"HRIS theke karo beton ba bonus ... jodi request
 * kora hoy ... eta must be finance ke hoy aprove korte hobe r na hoy reject
 * korbe nahole se jokhon payroll build korte jabe tokhoni take ekta popup a
 * warning dibe"*. Waiting or held — a hold is a decision deferred, not a
 * decision:
 *
 *   - a pay change that starts on or before the month's last day: the
 *     month is paid at one figure or the other, and which is undecided. On
 *     or before, not only within: a raise from 1 August still undecided when
 *     September is built leaves September's figure undecided too;
 *   - a one-off for that month.
 *
 * Budgets and spends are not here: they are paid from the ledger, not the
 * sheet.
 */
export async function blockingRequests(
  client: DbTransaction | DbService["client"],
  periodYear: number,
  periodMonth: number,
): Promise<BlockingRequest[]> {
  const result = await client.execute(sql`
    select 'pay_change' as "kind", c.id::text as "id",
           m.full_name as "teamMemberName", c.gross_amount::text as "amount",
           c.effective_from::text as "effectiveOn", c.status as "status"
      from compensation_requests c
      join team_members m on m.id = c.team_member_id
     where c.status in ('received', 'held')
       and m.deleted_at is null
       and c.effective_from
           <= (make_date(${periodYear}, ${periodMonth}, 1)
               + interval '1 month' - interval '1 day')::date
    union all
    select 'one_off', o.id::text, m.full_name, o.amount::text,
           make_date(o.period_year, o.period_month, 1)::text, o.status
      from payroll_one_offs o
      join team_members m on m.id = o.team_member_id
     where o.status in ('received', 'held')
       and m.deleted_at is null
       and o.period_year = ${periodYear}
       and o.period_month = ${periodMonth}
     order by 3, 1`);
  return result.rows as unknown as BlockingRequest[];
}

/** One line per request, as the pop-up lists them. */
export function describeBlocking(request: BlockingRequest): string {
  const waiting = request.status === "held" ? "on hold" : "waiting";
  const amount = formatMoney(request.amount, { currency: "BDT" });
  if (request.kind === "pay_change") {
    return `${request.teamMemberName} — salary change to ${amount} from ${formatIsoDate(request.effectiveOn)} (${waiting})`;
  }
  const [year, month] = request.effectiveOn.split("-").map(Number);
  return `${request.teamMemberName} — one-off ${amount} on the ${MONTHS[month - 1]} ${year} sheet (${waiting})`;
}

/**
 * Refuses, with the list, when anything blocks the month. The list travels
 * in `errors.hrRequests` — the one extra field the app's error filter passes
 * through — so the salary sheet can show it in a pop-up by name.
 */
export async function assertNothingBlocks(
  client: DbTransaction | DbService["client"],
  periodYear: number,
  periodMonth: number,
  doing: string,
): Promise<void> {
  const blocking = await blockingRequests(client, periodYear, periodMonth);
  if (blocking.length === 0) return;
  const label = `${MONTHS[periodMonth - 1]} ${periodYear}`;
  throw new ConflictException({
    message: `You cannot ${doing} for ${label} yet: HR has asked for ${blocking.length === 1 ? "a change" : `${blocking.length} changes`} to that month's pay. Approve or reject ${blocking.length === 1 ? "it" : "them"} on HR Requests first.`,
    errors: {
      hrRequests: blocking.map(describeBlocking),
      /* The same order: each line's own row in the queue, opened. */
      hrRequestLinks: blocking.map(
        (request) => `/hr-requests?kind=${request.kind}&open=${request.id}`,
      ),
    },
  });
}
