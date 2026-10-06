#!/usr/bin/env bash
#
# Reset the data for real use: the team and the accounts stay, four sign-ins
# stay, and everything else is emptied.
#
#     ./deploy/reset-keep-team-and-accounts.sh          # report only, changes nothing
#     ./deploy/reset-keep-team-and-accounts.sh --wipe   # do it, after a fresh dump
#
# The owner's words and their four answers are in
# docs/briefs/2026-10-04-reset-for-real-data.md. Run the report first and read
# it with the owner: it is the last moment anybody can say "not that one".
#
# KEPT WHOLE
#
#   team_members, team_socials, team_ereturns
#       The team, bank details and all: "team e users data sobgula thakuk".
#       Their pay history is not part of it — compensation_history is emptied,
#       the owner's answer 4.
#   accounts                         card secrets and opening balances included
#   categories
#   tax_policies, tax_policy_bands   the TDS slabs (answer 2)
#   app_settings                     keys and all (answer 2). Unlike
#                                    clean-for-production.sh, nothing is cleared.
#   schema_migrations                never emptied: the deploy decides from it
#                                    which files in deploy/sql still have to run
#
# KEPT IN PART
#
#   users                            the four sign-ins in KEEP_USERS; every
#                                    other one is deleted
#   user_two_factor, recovery_codes  the four's own rows
#   files                            the rows hung on a kept table — a team
#                                    member's documents, the company's logo and
#                                    signature. The rest go; their bytes stay in
#                                    the uploads folder until
#                                    ./deploy/sweep-orphan-files.sh --delete.
#
# EVERYTHING ELSE IS EMPTIED, taken from the database's own list of tables, so
# a table added after this was written is emptied by default rather than kept
# by mistake. That includes vendors with every plan (answer 3), salary history
# and the HR portal's requests (answer 4), and every session.
#
# A kept row that names a removed person — created_by, updated_by, deleted_by,
# a key's set_by, a file's uploaded_by — has that column set NULL, or pointed
# at the new Super Admin where the column cannot be NULL.
#
# Every step stops the script if it fails (set -e). A query that errors would
# otherwise print an empty answer, and an empty list of columns to clear or
# files to keep reads exactly like "there are none".
set -euo pipefail
trap 'echo "  stopped: the step on line $LINENO failed. Nothing was changed after the last line above." >&2' ERR

cd "$(dirname "$0")"

WIPE=0
[ "${1:-}" = "--wipe" ] && WIPE=1

# The sign-ins that stay, each with the role it must already have. The three
# people were made by the owner in Settings -> People who can sign in before
# this runs; the HR portal's login stays so the HR link holds (the owner,
# 4 Oct: "hr er connection vanga jabena tar login thakuk"). Its password is not
# touched — the HR portal keeps a sealed copy — and its session goes with
# everybody's, so it signs in again by itself on its next call.
KEEP_USERS="finance@shareviral.cash:super_admin
yeasin@shareviral.cash:cfo
delence@shareviral.cash:ceo
hr-portal@shareviral.cash:hr"
SUPER_ADMIN="finance@shareviral.cash"

KEEP_WHOLE="team_members team_socials team_ereturns accounts categories tax_policies tax_policy_bands app_settings schema_migrations"
PER_USER="user_two_factor recovery_codes"

# THIS project's `db`, asked of compose — never the first container whose name
# looks right. There is a second stack on this box (see clean-for-production.sh).
DB="$(COMPOSE_PROFILES=local-db docker compose ps -q db 2>/dev/null | head -n1 || true)"
if [ -z "$DB" ]; then
  echo "No database container found." >&2
  exit 1
fi
echo "Database container: $(docker inspect -f '{{.Name}}' "$DB" 2>/dev/null | sed 's#^/##')"

psql() {
  docker exec -i "$DB" \
    sh -c 'psql -tAq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<<"$1"
}

in_list() { echo " $2 " | grep -q " $1 "; }

EMAILS_SQL="$(echo "$KEEP_USERS" | cut -d: -f1 | sed "s/.*/'&'/" | paste -sd, -)"
KEEP_IDS="select id from users where lower(email) in (${EMAILS_SQL}) and deleted_at is null"
SUPER_ID="(select id from users where lower(email) = '${SUPER_ADMIN}' and deleted_at is null)"

# Which of the files' owner columns point at a kept table. Read from the
# constraints rather than written out, for the same reason as the table list.
FILES_KEEP_WHERE="$(psql "select coalesce(string_agg(quote_ident(a.attname) || ' is not null', ' or ' order by a.attname), 'false')
    from pg_constraint k
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
   where k.contype = 'f' and k.conrelid = 'public.files'::regclass
     and k.confrelid::regclass::text = any (string_to_array('${KEEP_WHOLE}', ' '))")"

TABLES="$(psql "select table_name from information_schema.tables
                 where table_schema='public' and table_type='BASE TABLE'
                 order by table_name")"

# --------------------------------------------------------------------------
# Every table, what is in it, and what happens to it.
# --------------------------------------------------------------------------
table_report() {
  printf '%-26s %10s   %s\n' "table" "rows" "what happens"
  printf '%-26s %10s   %s\n' "--------------------------" "----------" "------------"
  for t in $TABLES; do
    n="$(psql "select count(*) from \"$t\"")"
    if in_list "$t" "$KEEP_WHOLE"; then
      printf '%-26s %10s   kept\n' "$t" "$n"
    elif [ "$t" = "users" ]; then
      k="$(psql "select count(*) from users where id in (${KEEP_IDS})")"
      printf '%-26s %10s   kept %s: the sign-ins below\n' "$t" "$n" "$k"
    elif in_list "$t" "$PER_USER"; then
      k="$(psql "select count(*) from \"$t\" where user_id in (${KEEP_IDS})")"
      printf '%-26s %10s   kept %s: the kept sign-ins'"'"' own\n' "$t" "$n" "$k"
    elif [ "$t" = "files" ]; then
      k="$(psql "select count(*) from files where ${FILES_KEEP_WHERE}")"
      printf '%-26s %10s   kept %s: on a kept record (%s)\n' "$t" "$n" "$k" "$FILES_KEEP_WHERE"
    else
      printf '%-26s %10s   emptied\n' "$t" "$n"
    fi
  done
}

echo
table_report

# The truncate list: every table not kept whole and not kept in part — plus
# team_ereturns. TRUNCATE refuses a table that anything outside the statement
# points at, which is the point of naming them all and never cascading. But
# `files` points at transactions, payroll, subscriptions and the rest, so it
# has to be in the statement; and team_ereturns points at `files` (a return's
# receipt), so it has to be too. Both are copied aside first and put back,
# inside the same transaction.
TO_WIPE=""
for t in $TABLES; do
  if [ "$t" = "team_ereturns" ] || { ! in_list "$t" "$KEEP_WHOLE users $PER_USER"; }; then
    TO_WIPE="$TO_WIPE \"$t\","
  fi
done
TO_WIPE="${TO_WIPE%,}"

# --------------------------------------------------------------------------
# The sign-ins.
# --------------------------------------------------------------------------
PROBLEMS=0
echo
echo "Sign-ins kept:"
while IFS=: read -r email want; do
  row="$(psql "select role || ' ' || status || ' ' || (deleted_at is not null)
                 from users where lower(email) = lower('${email}')")"
  read -r role status deleted <<<"$row"
  if [ -z "$row" ]; then
    printf '  %-28s MISSING — make it in Settings -> People who can sign in first\n' "$email"
    PROBLEMS=$((PROBLEMS + 1))
  elif [ "$deleted" = "t" ]; then
    printf '  %-28s DELETED — restore it from the trash first\n' "$email"
    PROBLEMS=$((PROBLEMS + 1))
  elif [ "$role" != "$want" ]; then
    printf '  %-28s role is %s, should be %s — fix it first\n' "$email" "$role" "$want"
    PROBLEMS=$((PROBLEMS + 1))
  elif [ "$status" != "active" ]; then
    printf '  %-28s %s, %s — it should be active\n' "$email" "$role" "$status"
    PROBLEMS=$((PROBLEMS + 1))
  else
    printf '  %-28s %s\n' "$email" "$role"
  fi
done <<<"$KEEP_USERS"

echo
echo "Sign-ins removed:"
REMOVED="$(psql "select format('  %-28s %s', email, role::text)
                       || case when status <> 'active' then ', ' || status::text else '' end
                       || case when deleted_at is not null then ', in the trash' else '' end
                       || case when role = 'hr' then '   <- an HR login, not the portal''s' else '' end
                  from users where id not in (${KEEP_IDS}) order by created_at")"
echo "${REMOVED:-  none}"

# --------------------------------------------------------------------------
# What the owner should see go, by name, before it goes.
# --------------------------------------------------------------------------
echo
echo "Read these with the owner before --wipe:"
psql "select '  vendors ' || (select count(*) from vendors)
           || ', plans ' || (select count(*) from subscriptions)
           || ' — all emptied (answer 3: the plans go, and the vendors with them)'"
psql "select '  salary history rows ' || (select count(*) from compensation_history)
           || ' — emptied (answer 4)'"
psql "select '  HR Requests waiting ' || (a + b + c + d)
           || ' (pay changes ' || a || ', one-offs ' || b || ', budgets ' || c || ', spends ' || d
           || ') — emptied with every other HR request (answer 4)'
        from (select (select count(*) from compensation_requests where status in ('received','held')) a,
                     (select count(*) from payroll_one_offs      where status in ('received','held')) b,
                     (select count(*) from hr_budget_periods     where status in ('received','held')) c,
                     (select count(*) from hr_budget_spends      where status in ('received','held')) d) w"

# Kept rows that name somebody who is about to be removed. Any uuid column on a
# kept table that ends in _by, or that is a foreign key to users.
SCAN="$KEEP_WHOLE files users"
BY_COLS="$(psql "select c.table_name || ' ' || c.column_name || ' ' || c.is_nullable
    from information_schema.columns c
   where c.table_schema = 'public' and c.data_type = 'uuid'
     and c.table_name = any (string_to_array('${SCAN}', ' '))
     and (right(c.column_name, 3) = '_by'
          or exists (select 1 from pg_constraint k
                       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
                      where k.contype = 'f' and k.confrelid = 'public.users'::regclass
                        and k.conrelid = format('public.%I', c.table_name)::regclass
                        and a.attname = c.column_name))
   order by 1")"

kept_rows() {
  case "$1" in
    files) echo "($FILES_KEEP_WHERE)" ;;
    users) echo "id in (${KEEP_IDS})" ;;
    *) echo "true" ;;
  esac
}

echo
echo "Kept rows that name a removed person:"
NAMED=0
CLEAR_SQL=""
while read -r t c nullable; do
  [ -z "$t" ] && continue
  n="$(psql "select count(*) from \"$t\" where \"$c\" is not null and \"$c\" not in (${KEEP_IDS}) and $(kept_rows "$t")")"
  if [ "$nullable" = "YES" ]; then
    to="null"; said="cleared"
  else
    to="${SUPER_ID}"; said="set to ${SUPER_ADMIN}"
  fi
  CLEAR_SQL="${CLEAR_SQL}
update \"$t\" set \"$c\" = ${to} where \"$c\" is not null and \"$c\" not in (select id from reset_keep_users);"
  if [ "$n" != "0" ]; then
    printf '  %-40s %5s   %s\n' "$t.$c" "$n" "$said"
    NAMED=$((NAMED + n))
  fi
done <<<"$BY_COLS"
[ "$NAMED" = "0" ] && echo "  none"

echo
echo "Accounts — with no transactions left, each balance is its opening balance:"
ACCTS="$(psql "select format('  %-32s %16s   as of %s', name,
                           to_char(opening_balance, 'FM999,999,999,990.00'), opening_balance_on)
               from accounts where deleted_at is null order by name")"
echo "${ACCTS:-  none}"

if [ "$PROBLEMS" -gt 0 ]; then
  echo
  echo "  ${PROBLEMS} sign-in(s) above are not ready. --wipe will refuse until they are." >&2
fi

if [ "$WIPE" = "0" ]; then
  echo
  echo "  Report only — nothing was changed."
  echo "  Run again with --wipe to empty the tables marked above."
  exit 0
fi

if [ "$PROBLEMS" -gt 0 ]; then
  echo "  Stopping: nothing was changed." >&2
  exit 1
fi

echo
printf '  This empties the tables above and removes the sign-ins listed. Type RESET to go on: '
ANSWER=""
read -r ANSWER || true
if [ "$ANSWER" != "RESET" ]; then
  echo "  Not RESET — nothing was changed."
  exit 1
fi

# --------------------------------------------------------------------------
# The dump comes first, always — in backup.sh's format, so that
# ./deploy/restore.sh takes it as it is. Named so backup.sh's 30-day pruning,
# which only matches sfm_*, never deletes it.
# --------------------------------------------------------------------------
mkdir -p ./backups
DUMP="./backups/before-reset-$(TZ=Asia/Dhaka date +%Y-%m-%d_%H%M).sql.gz"
echo
echo "  writing $DUMP"
if ! docker exec "$DB" sh -c 'pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
     | gzip > "$DUMP"; then
  echo "  the dump failed — nothing has been emptied" >&2
  exit 1
fi
if ! gzip -t "$DUMP" 2>/dev/null; then
  echo "  $DUMP is not a readable gzip file — stopping, nothing emptied" >&2
  exit 1
fi
SIZE="$(wc -c < "$DUMP")"
DUMPED_TABLES="$(gzip -dc "$DUMP" | grep -c '^CREATE TABLE' || true)"
FINISHED="$(gzip -dc "$DUMP" | tail -n 5 | grep -c 'PostgreSQL database dump complete' || true)"
if [ "$SIZE" -lt 10000 ] || [ "$DUMPED_TABLES" -lt 10 ] || [ "$FINISHED" != "1" ]; then
  echo "  the dump is ${SIZE} bytes with ${DUMPED_TABLES} tables, or it is unfinished — stopping, nothing emptied" >&2
  exit 1
fi
echo "  $(du -h "$DUMP" | cut -f1) written, ${DUMPED_TABLES} tables"

# --------------------------------------------------------------------------
# One transaction. One TRUNCATE, no CASCADE: if anything outside the list
# points at something inside it, this fails and says so, and nothing changes.
# --------------------------------------------------------------------------
# Removing a sign-in: deleted outright. Should a foreign key refuse that, it is
# marked removed the way the trash marks it (deleted_at, deleted_by and a
# reason), disabled, and its tokens made worthless — and the summary says which.
REMOVE_USERS='do $reset$
begin
  delete from users where id not in (select id from reset_keep_users);
exception when foreign_key_violation then
  update users
     set deleted_at = now(), deleted_by = (select id from reset_super),
         delete_reason = '"'"'Removed in the reset for real data'"'"',
         status = '"'"'disabled'"'"', token_version = token_version + 1, updated_at = now()
   where id not in (select id from reset_keep_users) and deleted_at is null;
end
$reset$;'

echo
if psql "begin;
create temp table reset_keep_users on commit drop as ${KEEP_IDS};
create temp table reset_super on commit drop as select ${SUPER_ID} as id;
create temp table reset_keep_files on commit drop as select * from files where ${FILES_KEEP_WHERE};
create temp table reset_keep_ereturns on commit drop as select * from team_ereturns;

truncate ${TO_WIPE} restart identity;

insert into files select * from reset_keep_files;
insert into team_ereturns select * from reset_keep_ereturns;

delete from user_two_factor where user_id not in (select id from reset_keep_users);
delete from recovery_codes where user_id not in (select id from reset_keep_users);
${CLEAR_SQL}

${REMOVE_USERS}
commit;"; then
  echo "  emptied, in one transaction"
else
  echo "  the reset failed; the database is unchanged and the dump is at $DUMP" >&2
  exit 1
fi

LEFT="$(psql "select count(*) from users")"
KEPT="$(psql "select count(*) from users where id in (${KEEP_IDS})")"
if [ "$LEFT" = "$KEPT" ]; then
  echo "  the removed sign-ins were deleted"
else
  echo "  a foreign key refused deleting them, so the $((LEFT - KEPT)) removed sign-ins are marked removed"
  echo "  and disabled instead (deleted_at, as the trash does), and their tokens no longer work"
fi

echo
echo "After:"
table_report

echo
echo "  Done. The dump is $DUMP. Next:"
echo "    - everybody signs in again; the HR portal does it by itself on its next call"
echo "    - each account's real opening balance and date, before the real money goes in"
echo "    - the team's salaries; the vendors and their plans"
echo "    - ./deploy/sweep-orphan-files.sh, read it, then --delete: the removed files' bytes"
echo "    - the HR portal's own requests point at finance rows that are gone: paste the note"
