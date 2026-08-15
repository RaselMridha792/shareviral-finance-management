#!/usr/bin/env bash
# Restoring a dump. Run it before you need it.
#
#   ./deploy/restore.sh backups/sfm_2026-08-13_0200.sql.gz
#
# This overwrites the database it is pointed at. It refuses to touch a database
# that has transactions in it unless FORCE=1 is set, because the version of
# this you run in a panic is the one that overwrites the wrong thing.
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

DUMP="${1:-}"
GDRIVE_REMOTE="${GDRIVE_REMOTE:-gdrive:sfm-backups}"

# The day this is needed most is the day this server is gone and the only copy
# is on Drive. Take a remote path directly, so recovery does not also require
# remembering rclone's syntax at the worst possible moment.
if [ -n "${DUMP}" ] && [ ! -f "${DUMP}" ] && [[ "${DUMP}" == *:* ]]; then
  echo "Fetching ${DUMP}…"
  mkdir -p backups
  rclone copy "${DUMP}" backups/ --progress
  DUMP="backups/$(basename "${DUMP}")"
fi

if [ -z "${DUMP}" ] || [ ! -f "${DUMP}" ]; then
  echo "Usage: $0 <backups/sfm_YYYY-MM-DD_HHMM.sql.gz>" >&2
  echo "   or: $0 ${GDRIVE_REMOTE}/sfm_YYYY-MM-DD_HHMM.sql.gz" >&2
  echo >&2
  echo "On this server:" >&2
  ls -1t backups/*.sql.gz 2>/dev/null | head -10 >&2 || true
  echo "Off-site:" >&2
  rclone lsf --files-only "${GDRIVE_REMOTE}" 2>/dev/null | sort -r | head -10 >&2 || true
  exit 1
fi

EXISTING=$(docker compose exec -T db psql -tAX \
  --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "select count(*) from transactions" 2>/dev/null || echo 0)

if [ "${EXISTING}" -gt 0 ] && [ "${FORCE:-0}" != "1" ]; then
  cat >&2 <<MSG
Refusing: the target database already holds ${EXISTING} transactions.

If that is what you mean to replace, take a dump of it first:
  ./deploy/backup.sh
then run again with FORCE=1.
MSG
  exit 1
fi

echo "Restoring ${DUMP}…"
gzip -dc "${DUMP}" | docker compose exec -T db psql \
  --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  --set ON_ERROR_STOP=on --quiet

echo
echo "Restored. Now check it, rather than assuming:"
docker compose exec -T db psql -X --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -c "
  select
    (select count(*) from users)        as users,
    (select count(*) from transactions) as transactions,
    (select count(*) from audit_logs)   as audit_rows,
    (select max(txn_date) from transactions) as latest_entry;"

echo
echo "Then sign in against it. A restore nobody has signed in to is not verified."
