-- The salary TDS rule, as data — plus the FY 2026-27 policy seeded.
--
--   cd /opt/sfm/deploy
--   set -a; . ./.env; set +a
--   docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v ON_ERROR_STOP=1 < sql/2026-08-19-tax-policy.sql
--
-- Two new tables. Nothing reads them until the code that does is deployed, so
-- the order is the comfortable one for once — but run it first anyway, so the
-- Settings screen has a policy to show the moment it appears rather than an
-- empty form somebody has to fill in from a photograph of a spreadsheet.
--
-- ------------------------------------------------------------------------
-- Why a row per year rather than columns on app_settings
-- ------------------------------------------------------------------------
-- The app now works the tax out instead of storing a figure somebody typed, so
-- this rule is what produced every payslip. One editable row would mean July's
-- payslip re-rendering under August's rates the moment a band was adjusted —
-- silently, with nothing on the page to say the number had changed. Keyed by
-- income year, an old payslip can always be read against the rule that made it.
--
-- ------------------------------------------------------------------------
-- Where the seeded figures come from
-- ------------------------------------------------------------------------
-- The advisor's own worksheets for FY 2026-27, checked against twelve
-- calculations they did by hand. Eleven agree to the paisa; the twelfth has an
-- arithmetic slip, which is in the test suite with both figures.
--
-- Two of these are NOT in either spreadsheet and come from the handwriting:
--   * minimum_tax 5,000 — two of the twelve land on it
--   * the exemption cap, where the spreadsheets say 4,00,000 and the
--     handwriting 4,50,000. The owner has chosen 4,00,000, which is what is
--     seeded. Only the highest-paid employee is affected by the difference.
--
-- The rebate is stored as a bracket — 25% then 15% — rather than the 3.75% it
-- comes to. The collapsed figure would not move when somebody changes 25% to
-- 20% here, and moving it is the entire reason these are settings.
--
-- Safe to run twice: the tables are guarded, and the seed does nothing if a
-- policy for the year already exists, so a rule somebody has since edited is
-- never quietly reset to these numbers.

begin;

create table if not exists "tax_policies" (
	"id" uuid primary key default gen_random_uuid() not null,
	"entity_id" uuid,
	"fiscal_year" integer not null,
	"exemption_numerator" integer default 1 not null,
	"exemption_denominator" integer default 3 not null,
	"exemption_cap" numeric(14, 2) default '400000.00' not null,
	"rebate_investment_rate" numeric(6, 4) default '0.2500' not null,
	"rebate_rate" numeric(6, 4) default '0.1500' not null,
	"rebate_taxable_share" numeric(6, 4) default '0.0300' not null,
	"rebate_fixed_cap" numeric(14, 2) default '1000000.00' not null,
	"assume_full_investment" boolean default true not null,
	"minimum_tax" numeric(14, 2) default '5000.00' not null,
	"minimum_tax_enabled" boolean default true not null,
	"created_at" timestamp with time zone default now() not null,
	"updated_at" timestamp with time zone default now() not null,
	"created_by" uuid,
	"updated_by" uuid
);

create table if not exists "tax_policy_bands" (
	"id" uuid primary key default gen_random_uuid() not null,
	"policy_id" uuid not null,
	"position" smallint not null,
	"width" numeric(14, 2),
	"rate" numeric(6, 4) not null
);

-- `add constraint` has no IF NOT EXISTS in any Postgres version, so the
-- foreign key is guarded by name.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conname = 'tax_policy_bands_policy_id_tax_policies_id_fk'
	) then
		alter table "tax_policy_bands"
			add constraint "tax_policy_bands_policy_id_tax_policies_id_fk"
			foreign key ("policy_id") references "public"."tax_policies"("id")
			on delete cascade on update no action;
	end if;
end $$;

create unique index if not exists "tax_policies_year_idx"
	on "tax_policies" using btree ("fiscal_year");

create unique index if not exists "tax_policy_bands_order_idx"
	on "tax_policy_bands" using btree ("policy_id","position");

/* ------------------------------------------------------------------------ */
/*  Seed FY 2026-27, only if it is not already there                         */
/* ------------------------------------------------------------------------ */

insert into tax_policies (fiscal_year)
select 2026
where not exists (select 1 from tax_policies where fiscal_year = 2026);

-- The slab table. Only inserted alongside a policy that has no bands yet, so
-- a table somebody has edited is never topped up with a second copy.
insert into tax_policy_bands (policy_id, position, width, rate)
select p.id, v.position, v.width, v.rate
from tax_policies p
cross join (values
  (1::smallint,  400000.00::numeric, 0.0000::numeric),
  (2::smallint,  300000.00::numeric, 0.1000::numeric),
  (3::smallint,  400000.00::numeric, 0.1500::numeric),
  (4::smallint,  500000.00::numeric, 0.2000::numeric),
  (5::smallint, 2000000.00::numeric, 0.2500::numeric),
  -- No width: everything above. An arbitrary ceiling here would make the tax
  -- silently stop growing the day somebody's income passed it.
  (6::smallint,               null,  0.3000::numeric)
) as v(position, width, rate)
where p.fiscal_year = 2026
  and not exists (select 1 from tax_policy_bands b where b.policy_id = p.id);

commit;

-- What should come back: one policy for 2026, six bands, and the slab table
-- reading 0 / 10 / 15 / 20 / 25 / 30 in that order.
select
  p.fiscal_year,
  p.exemption_numerator || '/' || p.exemption_denominator as exemption_fraction,
  p.exemption_cap,
  p.rebate_investment_rate || ' then ' || p.rebate_rate as rebate_bracket,
  p.minimum_tax,
  p.assume_full_investment,
  (select count(*) from tax_policy_bands b where b.policy_id = p.id) as bands,
  (select string_agg((b.rate * 100)::int::text, ' / ' order by b.position)
     from tax_policy_bands b where b.policy_id = p.id) as rates_pct
from tax_policies p
where p.fiscal_year = 2026;
