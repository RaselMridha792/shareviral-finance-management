-- Two-factor: the enrolment table and the recovery codes.
--
--   cd /opt/sfm/deploy
--   docker compose exec -T db psql -U sfm -d sfm -v ON_ERROR_STOP=1 \
--     < sql/2026-08-18-two-factor.sql
--
-- Written out rather than applied with `drizzle-kit push`, for the same reason
-- as the files table before it: push compares the schema to the live database
-- and decides at run time what to execute. That is the right tool on a laptop
-- and the wrong one on the database this company keeps its money in — nobody
-- reads the statements first, and a rename it reads as a drop-and-add takes the
-- column's data with it. This file says exactly what runs, and can be read
-- before it does. (It is also the only option here: the API image is pruned to
-- production dependencies and ships `dist` without `src`, so there is no
-- drizzle-kit and no schema inside the container to push from.)
--
-- The names are drizzle's own, taken from `drizzle-kit generate` rather than
-- typed by hand, so a later `push` from a development machine sees a schema
-- that already matches and proposes nothing.
--
-- Safe to run twice.
--
-- ORDER MATTERS: run this BEFORE deploying the code that reads these tables.
-- Nothing shipped so far touches them, which is why they were committed on
-- their own — but the enrolment endpoints and the second login step do, and
-- against a database without these tables every one of those requests is a 500.

begin;

create table if not exists "user_two_factor" (
	"id" uuid primary key default gen_random_uuid() not null,
	"user_id" uuid not null,
	-- Encrypted, never the base32 an authenticator app would take. The nightly
	-- dump goes to Google Drive; a dump carrying both the password hash and the
	-- second factor has given away the point of having a second factor.
	"secret_encrypted" text not null,
	-- Null while enrolment is half-done: a QR has been shown but no code typed
	-- back. Nothing counts as enrolled until this is set, so an abandoned setup
	-- cannot lock anybody out.
	"confirmed_at" timestamp with time zone,
	-- The last time step accepted. Anything at or below it is refused, which is
	-- what stops a code being reused inside its own thirty-second window.
	"last_step" bigint,
	-- Wrong codes in a row. Separate from the password lockout on `users`:
	-- somebody guessing six digits has already passed that one, and 10^6 is not
	-- a large number without a counter of its own.
	"failed_count" bigint default 0 not null,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone default now() not null,
	"updated_at" timestamp with time zone default now() not null
);

create table if not exists "recovery_codes" (
	"id" uuid primary key default gen_random_uuid() not null,
	"user_id" uuid not null,
	-- SHA-256, not bcrypt. The opposite of the password rule and deliberate:
	-- bcrypt is slow to make guessable secrets expensive to guess, and these are
	-- random 80-bit strings this server generated. Nothing to guess.
	"code_hash" text not null,
	-- Kept rather than deleted, so "which code was spent, and when" survives.
	"used_at" timestamp with time zone,
	"used_ip" text,
	"created_at" timestamp with time zone default now() not null
);

-- `add constraint` has no IF NOT EXISTS before Postgres 16, and this file has
-- to be safe to run twice on whatever version is here.
do $$
begin
	if not exists (
		select 1 from pg_constraint where conname = 'user_two_factor_user_id_users_id_fk'
	) then
		alter table "user_two_factor"
			add constraint "user_two_factor_user_id_users_id_fk"
			foreign key ("user_id") references "public"."users"("id")
			on delete cascade on update no action;
	end if;

	if not exists (
		select 1 from pg_constraint where conname = 'recovery_codes_user_id_users_id_fk'
	) then
		alter table "recovery_codes"
			add constraint "recovery_codes_user_id_users_id_fk"
			foreign key ("user_id") references "public"."users"("id")
			on delete cascade on update no action;
	end if;
end $$;

-- One enrolment per person. Starting a new setup replaces the old row rather
-- than leaving two secrets that both open the door.
create unique index if not exists "user_two_factor_user_idx"
	on "user_two_factor" using btree ("user_id");

create unique index if not exists "recovery_codes_hash_idx"
	on "recovery_codes" using btree ("code_hash");

create index if not exists "recovery_codes_user_idx"
	on "recovery_codes" using btree ("user_id","used_at");

commit;

-- What it should say afterwards: two tables, three indexes, two foreign keys.
select
	(select count(*) from pg_tables
		where schemaname = 'public'
		  and tablename in ('user_two_factor','recovery_codes')) as tables,
	(select count(*) from pg_indexes
		where schemaname = 'public'
		  and indexname in ('user_two_factor_user_idx','recovery_codes_hash_idx','recovery_codes_user_idx')) as indexes,
	(select count(*) from pg_constraint
		where conname in ('user_two_factor_user_id_users_id_fk','recovery_codes_user_id_users_id_fk')) as foreign_keys;
