-- Everybody on Admin or Finance becomes CFO.
--
--   docker compose exec -T db psql -U sfm -d sfm < sql/2026-09-05-retire-admin-finance-roles.sql
--
-- RUN THIS BEFORE THE CODE, and this is the one migration where the order is
-- not about a missing column but about people being locked out.
--
-- The owner: *"admin role take delete kore daw and Finance Role take delete
-- kore daw ekhane Finance and CFO akoi role er under a ache tader kaj akoi and
-- admin er dorkar nai super admin holei hobe"* — and then, watching this land:
-- *"make sure kono data jeno na haray"*.
--
-- WHY THE ORDER MATTERS. `hasPermission()` looks the role up in a map and calls
-- `.has()` on the result. For a role the code no longer knows that map entry is
-- `undefined`, so it does not return false — it THROWS. A user still holding
-- `admin` after the code ships would get a 500 on every request in the app, not
-- a polite "you cannot do that". Measured, not assumed. So: move everyone
-- first, on the release before the roles disappear, while the running code
-- still understands both the old value and the new one.
--
-- WHY CFO. `ROLE_PERMISSIONS.cfo` and `ROLE_PERMISSIONS.admin` are the SAME
-- ARRAY — 29 of 31 permissions, everything except `settings.write` and
-- `users.manage`. So an Admin moved here loses nothing and gains nothing; only
-- the word changes. Finance gains four (accounts.write, categories.write,
-- team.write, audit.read), which is the owner's decision that the two roles are
-- one job. Super Admin was the other candidate and was declined for the obvious
-- reason: it would hand every one of these people the ability to change company
-- settings and to create and deactivate sign-in accounts, which they have never
-- had.
--
-- NOTHING IS DELETED. Not a user, not a row, not a figure. `users.role` is a
-- label on a person; changing it changes what they may do next, and touches
-- nothing they have already done. Every transaction, payroll line and file they
-- created keeps their id on it.
--
-- HISTORY KEEPS THE OLD NAMES. `audit_logs.actor_role` records the role somebody
-- held AT THE TIME, and those rows are deliberately left alone — an audit trail
-- rewritten to say somebody was always a CFO is not an audit trail. The code
-- keeps `Admin` and `Finance` as labels for exactly this reason, so an entry
-- from August still reads "Admin" rather than blank.
--
-- THE POSTGRES ENUM KEEPS BOTH VALUES. There is no `ALTER TYPE ... DROP VALUE`
-- in Postgres; removing one means recreating the type and rewriting every
-- column that uses it, on a live table, to delete two words. Not worth it, and
-- not necessary: once no row carries them they are two unused labels. The
-- Drizzle schema therefore keeps declaring all six, because it describes the
-- DATABASE. What shrinks is the list the app will hand out.
begin;

-- The before picture, so the change is legible in the deploy log.
select 'before' as at, role::text, count(*)::int as users
  from users group by role order by role;

/*
 * Who is moving, captured BEFORE they move.
 *
 * SQL has no "update, and hand the old value to an insert" that reads clearly,
 * so the pre-change picture is taken into a temp table first and the audit rows
 * are written from it afterwards. `on commit drop` means it lives exactly as
 * long as this transaction.
 *
 * It is also what makes the file idempotent: a second run finds nobody to move,
 * writes no audit rows, and changes nothing.
 */
create temporary table retiring_roles on commit drop as
  select id, full_name, role::text as old_role
    from users
   where role in ('admin', 'finance');

/*
 * Every row, including soft-deleted ones.
 *
 * A user in the trash still has a role, and restoring them after this ran is
 * exactly how one `admin` would reappear months later — on a release whose code
 * throws on it. Moving people first is defeated by leaving some behind because
 * they are not currently visible.
 */
update users
   set role = 'cfo',
       updated_at = now()
 where role in ('admin', 'finance');

/*
 * And a permanent record of who was what.
 *
 * This is raw SQL, so it does not pass through the service that writes the
 * audit log — which would leave the one change nobody can look up afterwards.
 * One row per person, the old role in `before` and the new one in `after`, the
 * same shape the app writes.
 *
 * `actor_user_id` and `actor_role` are null, as they are for every system job:
 * nobody clicked this.
 */
insert into audit_logs (
  actor_user_id, actor_role, action, entity_table, entity_id,
  summary, before, after, changed_fields, module, is_sensitive
)
select
  null,
  null,
  'update',
  'users',
  r.id::text,
  'Role retired: ' || r.full_name || ' moved from ' || initcap(r.old_role) ||
    ' to CFO. Admin and Finance were withdrawn; CFO carries the same permissions.',
  jsonb_build_object('role', r.old_role),
  jsonb_build_object('role', 'cfo'),
  array['role'],
  'users',
  false
from retiring_roles r;

commit;

-- Nobody may be left on either role. Both figures must read 0.
select 'after' as at,
  (select count(*)::int from users where role = 'admin')   as still_admin,
  (select count(*)::int from users where role = 'finance') as still_finance,
  (select count(*)::int from users where role = 'cfo')     as now_cfo,
  (select count(*)::int from users)                        as users_total;

-- And the history is untouched: entries from before today keep the role their
-- actor held at the time, which is the whole point of an audit trail.
select 'history kept' as at, actor_role::text, count(*)::int as entries
  from audit_logs
 where actor_role in ('admin', 'finance')
 group by actor_role order by actor_role;
