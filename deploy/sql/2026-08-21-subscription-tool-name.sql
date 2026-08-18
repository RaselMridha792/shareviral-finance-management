-- subscriptions.tool_name — a tool has a name, not a company behind it.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-21-subscription-tool-name.sql
--
-- ------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE. And after sql/2026-08-20-subscriptions.sql,
-- which is the file that creates the table this one alters.
-- ------------------------------------------------------------------------
-- A column on an existing table, not a new table. Drizzle names every column
-- in its SELECT and the subscriptions projection now lists `tool_name`, so
-- against a database without it *every* read of the register fails — the list,
-- one plan, the tools on somebody's profile — not the new field, the whole
-- query. And it fails as a bare 500, because the exception filter has one
-- branch for Zod errors and one for HttpException, and a driver error is
-- neither.
--
-- ------------------------------------------------------------------------
-- Why the column exists
-- ------------------------------------------------------------------------
-- A subscription hung off a `vendors` row, and the form minted one from
-- whatever was typed into the tool box — the same free-text-becomes-a-record
-- path `transactions` refuses on purpose, only worse, because a $20 plan put a
-- company on the books that nobody asked for and no screen ever showed.
--
-- Nothing was bought with it. Paying for a tool is an ordinary expense in a
-- category that already exists, and this register only ever needed to say
-- which tool a plan is for. A name does that.
--
-- ------------------------------------------------------------------------
-- Why vendor_id stays
-- ------------------------------------------------------------------------
-- It loses its NOT NULL rather than being dropped. On every row written before
-- today it is the only record of which company the plan was bought from — the
-- backfill below is the one chance to read that, and after it the column is
-- still the only place the answer lives. Nothing writes one now, so the
-- constraint has to go or the new form cannot insert at all.
--
-- The backfill can name every existing row, and that is not optimism:
-- vendor_id is NOT NULL today behind a foreign key, and vendors.name is NOT
-- NULL, so every subscription joins to exactly one name. NOT NULL on tool_name
-- is still applied conditionally rather than assumed — a database that
-- disagrees with that reasoning should keep its rows and say so in the
-- verification at the bottom, not refuse the whole file over one of them.
--
-- vendors.name is unbounded text and this column is varchar(160), which is
-- what the form accepts. A longer name is truncated rather than failing the
-- file: 160 characters is more than enough to recognise the tool, and a
-- deployment stopped by one absurd company name is the worse outcome.
--
-- Safe to run twice.

begin;

alter table subscriptions
  add column if not exists tool_name varchar(160);

-- Only where it is still empty, so a second run cannot overwrite a name
-- somebody has since corrected on the screen.
update subscriptions s
   set tool_name = left(btrim(v.name), 160)
  from vendors v
 where v.id = s.vendor_id
   and (s.tool_name is null or btrim(s.tool_name) = '')
   and btrim(v.name) <> '';

alter table subscriptions
  alter column vendor_id drop not null;

-- NOT NULL only if the backfill actually reached everything. One row it could
-- not name — a blank vendor name, or a subscription somehow carrying no
-- company — would abort this statement and take the rest of the file with it,
-- which leaves a deployment stuck on a single bad row. The count at the bottom
-- reports them instead, and the register falls back to the joined company name
-- for anything the column cannot answer for.
do $$
begin
  if not exists (
    select 1 from subscriptions
     where tool_name is null or btrim(tool_name) = ''
  ) then
    alter table subscriptions alter column tool_name set not null;
  end if;
end $$;

commit;

-- The first four should read true. `unnamed` is how many rows the backfill
-- could not name: at 0, tool_name_not_null is true and the register never has
-- to fall back. Above 0, the column is deliberately still nullable and those
-- rows keep showing their old company name until somebody edits them.
select
  (select count(*) = 1 from information_schema.columns
    where table_name = 'subscriptions'
      and column_name = 'tool_name') as tool_name_exists,
  (select character_maximum_length = 160 from information_schema.columns
    where table_name = 'subscriptions'
      and column_name = 'tool_name') as tool_name_160,
  (select is_nullable = 'NO' from information_schema.columns
    where table_name = 'subscriptions'
      and column_name = 'tool_name') as tool_name_not_null,
  (select is_nullable = 'YES' from information_schema.columns
    where table_name = 'subscriptions'
      and column_name = 'vendor_id') as vendor_id_nullable,
  (select count(*) from subscriptions
    where tool_name is null or btrim(tool_name) = '') as unnamed;
