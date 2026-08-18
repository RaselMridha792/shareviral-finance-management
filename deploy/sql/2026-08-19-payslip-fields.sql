-- What a payslip needs and the schema did not have.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-19-payslip-fields.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE.
-- ------------------------------------------------------------------------
-- Columns on `team_members` and `payroll_lines`, not new tables. Drizzle names
-- every column in its SELECT, so against a database without these, every read
-- of the team directory and the salary sheet fails — not the new fields, the
-- whole query — and it fails as a bare 500 because a driver error is neither a
-- ZodError nor an HttpException.
--
-- ------------------------------------------------------------------------
-- What each one is for
-- ------------------------------------------------------------------------
-- The company's payslip shows Basic, House Rent, Medical, Conveyance and
-- Internet as separate lines, and Salary Advance and Leave Without Pay as
-- separate deductions. The schema had one gross figure and one "other
-- deductions" figure, so the middle of the slip could not be drawn at all.
--
-- They are jsonb lists of {label, amount} rather than columns, because the next
-- allowance somebody invents should cost a label and not a migration.
--
-- And they are snapshots on the payroll line, not reads of the person's
-- current salary. compensation_history.components holds what somebody is paid
-- *now*; these hold what was actually paid that month. A payslip opened in
-- December must not show December's structure over August's figures - the bank
-- details beside them are frozen for the same reason.
--
-- `employee_code` had a column here once and it went with the uniqueness rule
-- that used it. It returns because the slip prints SVBD-0012 and builds its own
-- number from it, PS-2026AUG-0012. Unique only among the people who have one:
-- Postgres treats NULLs as distinct, which is right here, since everybody
-- without a code is not a clash.
--
-- `paid_days` / `working_days` draw "24 of 26". Nullable, because a full month
-- needs neither, and a slip that prints "26 of 26" every time teaches people to
-- stop reading it.
--
-- The six `app_settings` columns are the payslip's letterhead: the tagline
-- under the mark, the legal note beside the company name, the website and the
-- email on the contact line, and the two fields of the signature block. Six
-- columns rather than one block of text because each has its own place on the
-- page, and a single blob could not be laid out.
--
-- Safe to run twice.

begin;

alter table app_settings
  add column if not exists company_tagline varchar(120),
  add column if not exists company_legal_note varchar(200),
  add column if not exists company_website varchar(120),
  add column if not exists company_email varchar(160),
  add column if not exists payslip_signatory_name varchar(120),
  add column if not exists payslip_signatory_title varchar(120);

alter table team_members
  add column if not exists employee_code varchar(40);

alter table payroll_lines
  add column if not exists earnings_breakdown jsonb,
  add column if not exists deductions_breakdown jsonb,
  add column if not exists paid_days smallint,
  add column if not exists working_days smallint;

-- Matches the schema's expression index. entity_id is nullable on every row
-- today, and a plain unique index over a column that is NULL everywhere
-- enforces nothing — Postgres treats NULLs as distinct from each other.
create unique index if not exists team_members_employee_code_idx
  on team_members (
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    employee_code
  );

commit;

-- All five columns, and the index. Every one should read true.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'team_members' and column_name = 'employee_code') as employee_code,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'earnings_breakdown') as earnings,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'deductions_breakdown') as deductions,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'paid_days') as paid_days,
  (select count(*) = 1 from information_schema.columns
    where table_name = 'payroll_lines' and column_name = 'working_days') as working_days,
  (select count(*) = 6 from information_schema.columns
    where table_name = 'app_settings'
      and column_name in ('company_tagline', 'company_legal_note',
                          'company_website', 'company_email',
                          'payslip_signatory_name',
                          'payslip_signatory_title')) as letterhead,
  (select count(*) = 1 from pg_indexes
    where tablename = 'team_members'
      and indexname = 'team_members_employee_code_idx') as code_index;
