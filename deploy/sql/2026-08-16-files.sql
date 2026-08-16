-- The files table.
--
--   docker compose exec -T db psql -U sfm -d sfm -v ON_ERROR_STOP=1 \
--     < /opt/sfm/deploy/sql/2026-08-16-files.sql
--
-- Written out rather than applied with `drizzle-kit push`, which compares the
-- schema to the live database and issues whatever it decides is needed. That
-- is the right tool on a laptop and the wrong one on the database this company
-- keeps its money in: the statements are chosen at run time, nobody reads them
-- first, and a rename it interprets as a drop-and-add takes the column's data
-- with it. This file says exactly what runs, and can be read before it does.
--
-- The names below are drizzle's own — taken from `drizzle-kit generate`, not
-- typed by hand — so a later `push` from a development machine sees a schema
-- that already matches and proposes nothing.
--
-- Safe to run twice.

begin;

-- `create type` has no IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'file_kind') then
    create type "public"."file_kind" as enum (
      'profile_photo', 'cv', 'appointment_letter', 'salary_certificate',
      'nid', 'etin_certificate', 'receipt', 'import_source', 'other'
    );
  end if;
end
$$;

create table if not exists "files" (
  "id" uuid primary key default gen_random_uuid() not null,
  "storage_key" text not null,
  "original_name" text not null,
  "mime_type" text not null,
  "size_bytes" integer not null,
  "checksum" varchar(64) not null,
  "kind" "file_kind" not null,
  "label" text,
  "team_member_id" uuid,
  "transaction_id" uuid,
  "import_batch_id" uuid,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone,
  "deleted_by" uuid,

  -- Two rows naming one path means deleting either takes the other's bytes.
  constraint "files_storage_key_unique" unique ("storage_key"),

  constraint "files_size_positive" check ("files"."size_bytes" > 0),

  -- A file belongs to exactly one record. A row owned by nothing is
  -- unreachable from every screen and still occupying disk.
  constraint "files_one_owner" check ((case when "files"."team_member_id" is not null then 1 else 0 end
         + case when "files"."transaction_id" is not null then 1 else 0 end
         + case when "files"."import_batch_id" is not null then 1 else 0 end) = 1),

  -- Cascades, so deleting a person takes their documents' rows with them. The
  -- bytes are swept separately: see `deploy/sweep-orphan-files.sh`.
  constraint "files_team_member_id_team_members_id_fk"
    foreign key ("team_member_id") references "public"."team_members"("id") on delete cascade,
  constraint "files_transaction_id_transactions_id_fk"
    foreign key ("transaction_id") references "public"."transactions"("id") on delete cascade,
  constraint "files_import_batch_id_import_batches_id_fk"
    foreign key ("import_batch_id") references "public"."import_batches"("id") on delete cascade,
  -- Not a cascade: a document outlives the account of whoever uploaded it.
  constraint "files_uploaded_by_users_id_fk"
    foreign key ("uploaded_by") references "public"."users"("id") on delete set null
);

create index if not exists "files_team_member_idx" on "files" using btree ("team_member_id", "kind");
create index if not exists "files_transaction_idx" on "files" using btree ("transaction_id");
create index if not exists "files_import_batch_idx" on "files" using btree ("import_batch_id");
create index if not exists "files_checksum_idx" on "files" using btree ("checksum");

-- The read-only Adminer role, if it exists, should see this table too. Without
-- this the viewer shows twenty-three tables on a database that has
-- twenty-four, and looks stale rather than restricted.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'sfm_viewer') then
    grant select on "files" to sfm_viewer;
  end if;
end
$$;

commit;
