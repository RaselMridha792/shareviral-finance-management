#!/usr/bin/env bash
# A dump a day, kept for a month, sent off the server, and a restore that has
# actually been tried.
#
#   crontab -e
#   0 2 * * * /opt/sfm/deploy/backup.sh >> /var/log/sfm-backup.log 2>&1
#
# Runs on the host, against the db container. Dumps land in deploy/backups,
# which is bind-mounted — a backup inside a volume that dies with the container
# is not a backup. Then a copy goes to Google Drive, because a backup on the
# same disk as the database survives a bad migration and nothing else.
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

# --------------------------------------------------------------------------
# The copy that outlives the server
# --------------------------------------------------------------------------
# Everything above protects against a bad migration, a wrong DELETE, a broken
# deploy. None of it survives losing the machine. This part does.
#
# Set GDRIVE_REMOTE= (empty) in .env to switch it off deliberately. What is
# worth avoiding is the middle case: still switched on, failing every night,
# and saying so only in a log nobody opens. So every failure below exits
# non-zero and names what is missing.
GDRIVE_REMOTE="${GDRIVE_REMOTE:-gdrive:sfm-backups}"

if [ -z "${GDRIVE_REMOTE}" ]; then
  echo "         off-site copy switched off (GDRIVE_REMOTE is empty)"
  exit 0
fi

# cron hands a script almost no environment. rclone finds its config through
# HOME, and cron does set HOME — but this is not the file to leave that to.
export RCLONE_CONFIG="${RCLONE_CONFIG:-${HOME:-/root}/.config/rclone/rclone.conf}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "FAILED: rclone is not installed, so ${OUT} exists only on this server" >&2
  exit 1
fi

BASE="$(basename "${OUT}")"
echo "[$(TZ=Asia/Dhaka date)] sending ${BASE} to ${GDRIVE_REMOTE}"

if ! rclone copy "${OUT}" "${GDRIVE_REMOTE}/" --retries 3 --timeout 5m; then
  echo "FAILED: could not send ${BASE} to ${GDRIVE_REMOTE}." >&2
  echo "        The local dump is fine — there is no off-site copy of tonight." >&2
  echo "        Check the account first:  rclone about ${GDRIVE_REMOTE%%:*}:" >&2
  exit 1
fi

# rclone reporting success is rclone's opinion. Ask the other side instead:
# the file has to be there, and it has to be the same size.
LOCAL_BYTES=$(stat -c %s "${OUT}")
REMOTE_BYTES=$(rclone lsf --format sp --separator ';' --files-only "${GDRIVE_REMOTE}" \
  | awk -F';' -v want="${BASE}" '$2 == want { print $1 }')

if [ "${REMOTE_BYTES:-0}" != "${LOCAL_BYTES}" ]; then
  echo "FAILED: ${BASE} is ${LOCAL_BYTES} bytes here, ${REMOTE_BYTES:-absent} on Drive" >&2
  exit 1
fi

echo "         off-site copy verified — ${LOCAL_BYTES} bytes on both sides"

# Old copies go for good rather than to the Drive bin, where they would keep
# taking up the quota for another thirty days while appearing to be gone.
#
# Never reach for `rclone cleanup` here. That empties the entire Drive bin,
# including files this app has never touched.
#
# The --include is not decoration either: without it, anything else that ever
# lands in this folder becomes eligible for deletion.
rclone delete "${GDRIVE_REMOTE}" \
  --include 'sfm_*.sql.gz' \
  --min-age "${KEEP_DAYS}d" \
  --drive-use-trash=false || true

COPIES=$(rclone lsf --files-only --include 'sfm_*.sql.gz' "${GDRIVE_REMOTE}" 2>/dev/null | wc -l || true)
echo "         ${COPIES} backup(s) now off this server"
