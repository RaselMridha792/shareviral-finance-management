-- Bank charges belong to the top-level "Bank Charge" heading, never to a
-- sub-category inside another heading (the owner, 31 Oct 2026: "eta vul
-- administrative er under a bank charge dhukbena. eta change koro. ei vulta
-- jeno future a r na hoy").
--
-- The August category set (2026-08-26-categories.sql) put "Bank charges"
-- under Administrative, and the code filed every automatic charge there by
-- that slug, while the "Bank Charge" heading the owner made stayed empty. The
-- code now files charges under the top-level heading only, and the categories
-- service refuses a "bank charge" sub-category. This file moves what was
-- already filed:
--
--   1. a top-level "Bank Charge" heading, made (or brought back from the
--      trash) only if there is none;
--   2. every entry under a "bank charge" sub-category moves to that heading
--      — trashed and voided ones too, so a restore lands in the right place;
--   3. the emptied sub-category goes to the trash. A soft delete, not a
--      DELETE: the August file's own `not exists` still sees the row, so
--      replaying the folder in order does not put the sub-category back.
--
-- The heading is picked as the code picks it: top-level, money out, not
-- trashed, slug bank-charge(s) or a name like "bank charge", oldest first.
-- Every step is guarded, so a second run changes nothing. Amounts, dates and
-- accounts do not move; only the heading an entry is filed under.

-- 1a. A trashed heading comes back rather than a second one being made.
update categories c
   set deleted_at = null, deleted_by = null, delete_reason = null,
       is_active = true, updated_at = now()
 where c.id = (
         select t.id from categories t
          where t.parent_id is null and t.kind = 'out'
            and t.deleted_at is not null
            and (t.slug in ('bank-charge', 'bank-charges')
                 or t.name ilike '%bank charge%')
          order by t.created_at, t.id
          limit 1)
   and not exists (
         select 1 from categories h
          where h.parent_id is null and h.kind = 'out'
            and h.deleted_at is null
            and (h.slug in ('bank-charge', 'bank-charges')
                 or h.name ilike '%bank charge%'));

-- 1b. None at all: make it.
insert into categories (name, slug, kind, parent_id, color, sort_order, is_system)
select 'Bank Charge', 'bank-charge', 'out', null, '#dc2626',
       coalesce((select max(sort_order) from categories where parent_id is null), 0) + 10,
       true
 where not exists (
         select 1 from categories h
          where h.parent_id is null and h.kind = 'out'
            and h.deleted_at is null
            and (h.slug in ('bank-charge', 'bank-charges')
                 or h.name ilike '%bank charge%'));

-- 2. Every entry under a "bank charge" sub-category, to the heading.
with heading as (
  select h.id from categories h
   where h.parent_id is null and h.kind = 'out'
     and h.deleted_at is null
     and (h.slug in ('bank-charge', 'bank-charges')
          or h.name ilike '%bank charge%')
   order by h.created_at, h.id
   limit 1
)
update transactions t
   set category_id = (select id from heading),
       updated_at = now()
 where exists (select 1 from heading)
   and t.category_id in (
         select c.id from categories c
          where c.parent_id is not null and c.kind = 'out'
            and (c.slug = 'bank-charges' or c.name ilike '%bank charge%'));

-- 3. The emptied sub-category, to the trash.
update categories c
   set deleted_at = now(), is_active = false, updated_at = now(),
       delete_reason = 'Bank charges have their own top-level heading (31 Oct 2026)'
 where c.parent_id is not null and c.kind = 'out'
   and (c.slug = 'bank-charges' or c.name ilike '%bank charge%')
   and c.deleted_at is null
   and not exists (select 1 from transactions t where t.category_id = c.id);
