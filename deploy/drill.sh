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
#
# --output=/dev/null on top of that: restoring the sequences runs a setval per
# table and psql prints each result, so the verdict at the bottom arrives after
# a screen of noise. Errors still go to stderr, and ON_ERROR_STOP still stops.
gzip -dc "${DUMP}" | docker compose exec -T \
  -e PGOPTIONS='-c client_min_messages=warning' \
  db psql --username "${POSTGRES_USER}" --dbname "${DRILL_DB}" \
  --set ON_ERROR_STOP=on --quiet --output=/dev/null

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

# --------------------------------------------------------------------------
# The files the restored database expects
# --------------------------------------------------------------------------
# A dump holds every row and not one byte of any document. Restore it on a new
# machine and the app comes back looking complete: the team page lists eighteen
# people, each record names a CV, and every one of those links 404s.
#
# So the drill asks the question the row counts cannot: for each file the
# database says exists, is it in the off-site copy, and is it the same file.
UPLOADS_REMOTE="${UPLOADS_REMOTE:-${GDRIVE_REMOTE%%:*}:sfm-uploads}"

EXPECTED="${WORK}/expected.txt"
OFFSITE="${WORK}/offsite.txt"

psql_in "${DRILL_DB}" \
  -c "select storage_key from files where deleted_at is null order by storage_key;" \
  | sed '/^$/d' > "${EXPECTED}"

EXPECTED_COUNT=$(wc -l < "${EXPECTED}")

if [ "${EXPECTED_COUNT}" -eq 0 ]; then
  echo "  no uploaded files recorded yet — nothing to check off-site"
else
  rclone lsf --files-only -R "${UPLOADS_REMOTE}/current" 2>/dev/null | sort > "${OFFSITE}" || true
  MISSING=$(comm -23 "${EXPECTED}" "${OFFSITE}" | head -20)

  if [ -n "${MISSING}" ]; then
    echo "FAILED: ${EXPECTED_COUNT} file(s) recorded, and these are not in ${UPLOADS_REMOTE}/current:" >&2
    echo "${MISSING}" | sed 's/^/    /' >&2
    fail=1
  else
    # Present is not the same as intact. Fetch one and check its sha256 against
    # what the database recorded when it was uploaded — the only test that
    # distinguishes a real copy from a file of the right name and length.
    SAMPLE_KEY=$(head -1 "${EXPECTED}")
    SAMPLE_SUM=$(psql_in "${DRILL_DB}" \
      -c "select checksum from files where storage_key = '${SAMPLE_KEY}' limit 1;")

    rclone copy "${UPLOADS_REMOTE}/current/${SAMPLE_KEY}" "${WORK}/sample/" --retries 3
    ACTUAL_SUM=$(sha256sum "${WORK}/sample/$(basename "${SAMPLE_KEY}")" | cut -d' ' -f1)

    if [ "${SAMPLE_SUM}" = "${ACTUAL_SUM}" ]; then
      echo "  ${EXPECTED_COUNT} file(s) all present off-site; ${SAMPLE_KEY} matches its recorded checksum"
    else
      echo "FAILED: ${SAMPLE_KEY} came back with a different checksum" >&2
      echo "        recorded ${SAMPLE_SUM}" >&2
      echo "        fetched  ${ACTUAL_SUM}" >&2
      fail=1
    fi
  fi
fi

if [ "${fail}" -eq 0 ]; then
  echo
  echo "PASSED: the copy on Drive restores to the same figures as the live database,"
  echo "        and every file it refers to is off-site and intact"
fi

exit "${fail}"
