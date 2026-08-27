import { sql } from "drizzle-orm";

/**
 * Whether a challan counts as tax that has actually been handed over.
 *
 * There are two ways a deposit stops being real, and every figure that adds
 * challans up has to honour both:
 *
 *  - **It was moved to the trash.** The register that lists challans filtered
 *    `deleted_at` from the day it was written. The figures did not, so a
 *    trashed challan left the screen and its money stayed in the totals: the
 *    month read `outstanding 0.00`, the Reports overview counted it as
 *    deposited, and the dashboard's "withheld but not yet deposited" warning
 *    never fired. An unpaid tax obligation reading as settled is the worst
 *    shape this particular bug can take, because nothing on any screen
 *    contradicts it — the row is simply gone and the total is simply wrong.
 *  - **The payment behind it was voided.** Three of the six places already
 *    asked this one. Voiding the ledger entry is how a mis-entered deposit is
 *    undone, and leaving it in the total shows the tax as settled when the
 *    money came back.
 *
 * So the rule lives here, once, and every place that sums `tds_deposits` reads
 * it. That is deliberate and it is the lesson this codebase keeps re-learning:
 * a condition restated in six queries is a condition that is correct in five
 * of them, and the sixth is found by an owner rather than by a test.
 *
 * Two things it is **not**:
 *
 *  - It is not the filter for *listing* challans. The register answers "what
 *    challans exist", which is a different question from "what counts as
 *    paid" — a challan whose payment was voided is still a record somebody
 *    entered, and hiding it would leave nothing to correct.
 *  - It is not for `AccountsService.attachments()`, which counts what still
 *    points at an account so it can say whether the account is deletable. A
 *    trashed challan is still a row holding a foreign key, and the database
 *    will still refuse the delete. Filtering there would promise a delete that
 *    Postgres then rejects.
 *
 * The table and column names are written out rather than interpolated from the
 * schema objects on purpose: Drizzle renders `${table.column}` inside raw SQL
 * as the bare column name, which inside a correlated subquery binds to the
 * inner table instead of the outer one. That has already cost this repository
 * a day — a subquery that compared a row to itself, was false on every row,
 * and looked perfectly correct in the diff.
 */
export const CHALLAN_COUNTS = sql`
  "tds_deposits"."deleted_at" is null
  and not exists (
    select 1 from "transactions"
    where "transactions"."id" = "tds_deposits"."transaction_id"
      and "transactions"."voided_at" is not null
  )`;

/**
 * The same rule, reached from a query whose FROM is `tds_allocations`.
 *
 * The undeposited-tax reminder sums allocations rather than challans, so it
 * needs the deposit brought into scope before the rule can be applied to it.
 * Without this a trashed challan still covered its payroll lines and the
 * reminder stayed quiet about tax nobody had paid.
 */
export const ALLOCATION_COUNTS = sql`
  exists (
    select 1 from "tds_deposits"
    where "tds_deposits"."id" = "tds_allocations"."deposit_id"
      and (${CHALLAN_COUNTS})
  )`;
