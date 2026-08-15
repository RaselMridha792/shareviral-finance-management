#!/usr/bin/env bash
# The rehearsal. Run it while nothing is wrong.
#
#   ./deploy/drill.sh                              # the newest copy on Drive
#   ./deploy/drill.sh sfm_2026-08-16_0310.sql.gz   # a particular one
#
# Fetches the off-site copy back from Google Drive, restores it into a scratch
# database beside the live one, and compares the two. The live database is
# never written to, and the scratch one is dropped on the way out whether this
# passes or fails.
#
# It deliberately does not use the dump already sitting in backups/. That file
# is not the copy that would be left if this machine were gone, and restoring
# it only proves the server can read its own disk — which was never the
# question. The question is whether the bytes on Drive are a database.
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

GDRIVE_REMOTE="${GDRIVE_REMOTE:-gdrive:sfm-backups}"
DRILL_DB="${DRILL_DB:-sfm_drill}"
WORK="$(mktemp -d)"

psql_in() {
  docker compose exec -T db psql -tAX \
    --username "${POSTGRES_USER}" --dbname "$1" "${@:2}"
}

cleanup() {
  rm -rf "${WORK}"
  psql_in postgres -c "drop database if exists ${DRILL_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --------------------------------------------------------------------------
NAME="${1:-}"
if [ -z "${NAME}" ]; then
  NAME="$(rclone lsf --files-only --include 'sfm_*.sql.gz' "${GDRIVE_REMOTE}" | sort | tail -1)"
fi

if [ -z "${NAME}" ]; then
  echo "FAILED: nothing to restore — ${GDRIVE_REMOTE} holds no sfm_*.sql.gz" >&2
  exit 1
fi

echo "Fetching ${GDRIVE_REMOTE}/${NAME}"
rclone copy "${GDRIVE_REMOTE}/${NAME}" "${WORK}/"

DUMP="${WORK}/${NAME}"
if [ ! -f "${DUMP}" ]; then
  echo "FAILED: ${NAME} never arrived" >&2
  exit 1
fi

gzip -t "${DUMP}"
echo "        came back, $(du -h "${DUMP}" | cut -f1), and reads as gzip"

# --------------------------------------------------------------------------
echo "Restoring into ${DRILL_DB} — the live database is not touched"
psql_in postgres -c "drop database if exists ${DRILL_DB};" >/dev/null
psql_in postgres -c "create database ${DRILL_DB};" >/dev/null

# The dump opens with DROP … IF EXISTS against an empty database, so without
# this the useful output is buried under a page of skipping notices.
gzip -dc "${DUMP}" | docker compose exec -T \
  -e PGOPTIONS='-c client_min_messages=warning' \
  db psql --username "${POSTGRES_USER}" --dbname "${DRILL_DB}" \
  --set ON_ERROR_STOP=on --quiet

# --------------------------------------------------------------------------
fail=0

TABLES=$(psql_in "${DRILL_DB}" -c "select count(*) from pg_tables where schemaname='public';")
USERS=$(psql_in "${DRILL_DB}" -c "select count(*) from users;")
USABLE=$(psql_in "${DRILL_DB}" -c "select count(*) from users where password_hash is not null and length(password_hash) > 20;")

if [ "${TABLES}" -lt 10 ]; then
  echo "FAILED: only ${TABLES} tables came back" >&2
  fail=1
fi

# A restore nobody can sign in to is not a recovery. The hashes have to have
# survived, or the data is readable and the app is still unusable.
if [ "${USERS}" -lt 1 ]; then
  echo "FAILED: no users in the restored copy — nobody could sign in to it" >&2
  fail=1
elif [ "${USABLE}" -ne "${USERS}" ]; then
  echo "FAILED: ${USERS} users but ${USABLE} with a usable password hash" >&2
  fail=1
fi

snapshot() {
  psql_in "$1" -c "
    select concat_ws('  ',
      'tables=' || (select count(*) from pg_tables where schemaname = 'public'),
      'users='  || (select count(*) from users),
      'team='   || (select count(*) from team_members),
      'txns='   || (select count(*) from transactions),
      'audit='  || (select count(*) from audit_logs),
      'net='    || coalesce((select sum(signed_amount)::text from transactions
                             where voided_at is null), '0'));"
}

LIVE="$(snapshot "${POSTGRES_DB}")"
BACK="$(snapshot "${DRILL_DB}")"

# Aligned, because the whole point of these two lines is reading them down the
# column rather than across.
printf '\n  live       %s\n  from Drive %s\n\n' "${LIVE}" "${BACK}"

if [ "${LIVE}" != "${BACK}" ]; then
  # Not automatically a failure: rows written after the dump was taken belong
  # in the live column and nowhere else. But it is never something to skim
  # past, so it exits non-zero and asks for a human to say which it is.
  echo "The two differ. That is expected only if the database changed after" >&2
  echo "${NAME} was taken. Satisfy yourself the difference is that, and not" >&2
  echo "something missing from the backup." >&2
  fail=1
fi

if [ "${fail}" -eq 0 ]; then
  echo "PASSED: the copy on Drive restores to the same figures as the live database"
fi

exit "${fail}"
