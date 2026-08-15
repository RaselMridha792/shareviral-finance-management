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
LINES=$(gzip -dc "${OUT}" | head -50 | grep -c "CREATE TABLE" || true)
if [ "${LINES}" -eq 0 ]; then
  echo "WARNING: no CREATE TABLE in the first 50 lines of ${OUT}" >&2
fi

echo "[$(TZ=Asia/Dhaka date)] wrote ${OUT} (${SIZE})"

find backups -name 'sfm_*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete
