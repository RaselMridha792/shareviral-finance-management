#!/usr/bin/env bash
# A dump a day, kept for a month, and a restore that has actually been tried.
#
#   crontab -e
#   0 2 * * * /opt/sfm/deploy/backup.sh >> /var/log/sfm-backup.log 2>&1
#
# Runs on the host, against the db container. Dumps land in deploy/backups,
# which is bind-mounted — a backup inside a volume that dies with the container
# is not a backup.
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(TZ=Asia/Dhaka date +%Y-%m-%d_%H%M)"
OUT="backups/sfm_${STAMP}.sql.gz"

mkdir -p backups

echo "[$(TZ=Asia/Dhaka date)] dumping to ${OUT}"
# --clean --if-exists so the dump can be restored over an existing database
# without hand-dropping it first, which is exactly the moment mistakes happen.
docker compose exec -T db pg_dump \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --clean --if-exists --no-owner \
  | gzip > "${OUT}"

# A dump that cannot be read back is worse than none: it is a false sense of
# safety. Check now, while there is still a working database to re-dump from.
if ! gzip -t "${OUT}"; then
  echo "FAILED: ${OUT} is not a readable gzip file" >&2
  rm -f "${OUT}"
  exit 1
fi

SIZE=$(du -h "${OUT}" | cut -f1)

# Does the dump actually carry the schema and the rows?
#
# This used to look for CREATE TABLE in the first fifty lines and warn when it
# found none — which it never does, because a --clean dump opens with DROP and
# SET statements and reaches the first table far below line fifty. So every
# healthy backup printed a warning, and a warning that is always wrong teaches
# people to ignore warnings. The one night it means something, nobody reads it.
#
# Counting across the whole file is both correct and a stronger check, and a
# dump missing its schema is worthless rather than merely suspect — so this
# fails the run instead of muttering about it.
TABLES=$(gzip -dc "${OUT}" | grep -c '^CREATE TABLE' || true)
ROWS=$(gzip -dc "${OUT}" | grep -c '^COPY public\.' || true)

if [ "${TABLES}" -lt 10 ]; then
  echo "FAILED: ${OUT} defines only ${TABLES} tables — the schema has far more" >&2
  echo "        Keeping the file so it can be examined, but do not rely on it." >&2
  exit 1
fi

if [ "${ROWS}" -lt 5 ]; then
  echo "FAILED: ${OUT} carries only ${ROWS} data section(s) — the tables look empty" >&2
  exit 1
fi

echo "         ${TABLES} tables, ${ROWS} data sections"

echo "[$(TZ=Asia/Dhaka date)] wrote ${OUT} (${SIZE})"

find backups -name 'sfm_*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete
