#!/usr/bin/env bash
#
# Empty the database of everything that is not a sign-in, before real money
# goes in.
#
#     ./deploy/clean-for-production.sh            # report only, changes nothing
#     ./deploy/clean-for-production.sh --wipe     # do it, after a fresh backup
#
# Run the report first. It prints every table, what is in it now, and whether
# this would empty it — which is the only way to decide about the handful of
# tables that are seeded but are not really sample data.
#
# WHAT IS KEPT, and why each one:
#
#   users, user_two_factor, recovery_codes
#       The sign-ins and their second factor. Everything else in here can be
#       typed again; an account nobody can get into cannot.
#
#   app_settings
#       The row stays because a CHECK constraint says there is exactly one of
#       it. Its contents do not: the Resend key, the Anthropic key and the mail
#       addresses are cleared, so nothing carries a live credential or starts
#       mailing anybody about sample data that no longer exists.
#
#   schema_migrations
#       The deploy's record of which files in deploy/sql it has applied.
#       Emptying it would make the next deploy replay the whole directory, and
#       that directory is not order-independent.
#
# EVERYTHING ELSE IS EMPTIED, including the ones worth thinking about first:
#
#   tax_policies, tax_policy_bands
#       The NBR slabs. Seeded, so technically sample — but payroll cannot work
#       out a single deduction without them, and the app will not compute TDS
#       again until this year's real slabs are entered in Settings.
#
#   categories, accounts
#       The chart of accounts. Nothing can be filed anywhere until they exist
#       again.
#
#   refresh_tokens
#       Every session ends. Everybody signs in again, which is the right side
#       to err on after a wipe.
#
# The uploaded files are not touched here. Their rows go; the bytes stay in
# /data/uploads until `./deploy/sweep-orphan-files.sh --delete` removes them,
# and that is deliberate — deleting rows is recoverable from the dump this
# script takes, and deleting bytes is not.
set -uo pipefail

cd "$(dirname "$0")"

WIPE=0
[ "${1:-}" = "--wipe" ] && WIPE=1

DB="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 -- '-db-')"
if [ -z "$DB" ]; then
  echo "No database container found." >&2
  exit 1
fi

psql() {
  docker exec -i "$DB" \
    sh -c 'psql -tAq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<<"$1"
}

# The tables that survive. Everything else in `public` is emptied, so a table
# added later is wiped by default rather than quietly kept — the safer way for
# a list like this to be out of date.
KEEP="users user_two_factor recovery_codes app_settings schema_migrations"

TABLES="$(psql "select table_name from information_schema.tables
                 where table_schema='public' and table_type='BASE TABLE'
                 order by table_name")"

echo
printf '%-26s %10s   %s\n' "table" "rows" "what happens"
printf '%-26s %10s   %s\n' "--------------------------" "----------" "------------"

TO_WIPE=""
for t in $TABLES; do
  n="$(psql "select count(*) from \"$t\"")"
  if echo " $KEEP " | grep -q " $t "; then
    if [ "$t" = "app_settings" ]; then
      printf '%-26s %10s   kept, credentials cleared\n' "$t" "$n"
    else
      printf '%-26s %10s   kept\n' "$t" "$n"
    fi
  else
    printf '%-26s %10s   emptied\n' "$t" "$n"
    TO_WIPE="$TO_WIPE \"$t\","
  fi
done

TO_WIPE="${TO_WIPE% ,}"
TO_WIPE="${TO_WIPE%,}"

echo
psql "select '  sign-ins kept: ' || string_agg(email || ' (' || role || ')', ', ' order by created_at)
        from users where deleted_at is null"

if [ "$WIPE" = "0" ]; then
  echo
  echo "  Report only — nothing was changed."
  echo "  Run again with --wipe to empty the tables marked above."
  exit 0
fi

# --------------------------------------------------------------------------
# The dump comes first, always.
# --------------------------------------------------------------------------
mkdir -p ./backups
STAMP="$(docker exec "$DB" date -u +%Y%m%d-%H%M%S)"
DUMP="./backups/before-production-clean-${STAMP}.sql"
echo
echo "  writing $DUMP"
if ! docker exec "$DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$DUMP"; then
  echo "  the dump failed — nothing has been emptied" >&2
  exit 1
fi
SIZE="$(wc -c < "$DUMP")"
if [ "$SIZE" -lt 10000 ]; then
  echo "  the dump is only ${SIZE} bytes, which cannot be right — stopping" >&2
  exit 1
fi
echo "  $(du -h "$DUMP" | cut -f1) written"

# --------------------------------------------------------------------------
# One statement, no CASCADE.
# --------------------------------------------------------------------------
# Every table is named, so if something outside the list points at something
# inside it, this fails and says so. CASCADE would instead reach out and empty
# whatever that was — which for a list whose whole purpose is "keep exactly
# these five" is the one thing it must not do.
echo
if psql "truncate ${TO_WIPE} restart identity"; then
  echo "  tables emptied"
else
  echo "  truncate failed; the database is unchanged and the dump is at $DUMP" >&2
  exit 1
fi

# The row stays, its secrets do not.
psql "update app_settings set
        resend_api_key = null, resend_key_set_at = null, resend_key_set_by = null,
        email_from = null, email_admin_address = null, email_enabled = false,
        anthropic_api_key = null, anthropic_key_set_at = null, anthropic_key_set_by = null
      where id = 1" >/dev/null
echo "  credentials cleared from app_settings"

echo
echo "  Done. Next:"
echo "    - everybody signs in again; the sessions went with the rest"
echo "    - Settings needs this year's tax slabs before payroll can deduct"
echo "    - the chart of accounts and the categories have to be entered"
echo "    - the Resend key has to be pasted again before any mail is sent"
echo "    - ./deploy/sweep-orphan-files.sh --delete removes the uploaded bytes"
