#!/usr/bin/env bash
# Files on disk that no row points at, and rows that point at no file.
#
#   ./deploy/sweep-orphan-files.sh            # report only
#   ./deploy/sweep-orphan-files.sh --delete   # remove the orphaned bytes
#
# Deleting a person cascades their file *rows* away; the bytes are not in the
# database and stay where they are. That is the safe direction to fail in — the
# alternative is a delete that half-succeeds and takes files with it — but it
# leaves disk nobody can see, and disk nobody can see is only noticed when it
# runs out.
#
# The second half matters more. A row whose file is missing is a broken
# download waiting for the person who needs it most, and it is exactly what a
# restore that brought back the database and forgot the uploads looks like.
#
# Which is why the sample rows are counted and not listed. The bulk seeder
# writes `demo/<uuid>` as a storage key and never writes a file behind it, so
# every one of its rows is a "broken download" that was never anything else.
# A hundred and twenty of them would report a missing upload every single run —
# and an alarm that always sounds is not an alarm. The day a restore really
# does lose the uploads, that warning has to arrive on its own.
#
# Only this direction ignores them. Bytes on disk under `demo/` would still be
# orphans worth removing; nothing writes any today, and if something starts, it
# should be found.
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

UPLOADS="${UPLOADS_DIR:-./uploads}"
DELETE=0
[ "${1:-}" = "--delete" ] && DELETE=1

if [ ! -d "${UPLOADS}" ]; then
  echo "No uploads directory at ${UPLOADS} — nothing to sweep."
  exit 0
fi

KNOWN="$(mktemp)"
ONDISK="$(mktemp)"
trap 'rm -f "${KNOWN}" "${ONDISK}"' EXIT

# Every key the database believes in, deleted rows included: a soft-deleted row
# has already had its bytes removed, so a file still on disk under that key is
# an orphan either way.
docker compose exec -T db psql -tAX \
  --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" \
  -c "select storage_key from files where deleted_at is null;" \
  | sed '/^$/d' | sort > "${KNOWN}"

( cd "${UPLOADS}" && find . -type f ! -name '.*' -printf '%P\n' ) | sort > "${ONDISK}"

echo "rows expecting a file: $(wc -l < "${KNOWN}")"
echo "files on disk:         $(wc -l < "${ONDISK}")"
echo

echo "--- on disk, no row (orphaned bytes)"
ORPHANS="$(comm -13 "${KNOWN}" "${ONDISK}")"
if [ -z "${ORPHANS}" ]; then
  echo "    none"
else
  echo "${ORPHANS}" | sed 's/^/    /'
  if [ "${DELETE}" = "1" ]; then
    echo "${ORPHANS}" | while IFS= read -r key; do rm -f -- "${UPLOADS}/${key}"; done
    echo "    deleted."
  else
    echo "    (run with --delete to remove)"
  fi
fi

echo
echo "--- row, no file on disk (broken downloads)"
ALL_MISSING="$(comm -23 "${KNOWN}" "${ONDISK}")"

# `|| true` on both: grep exits 1 when it matches nothing, which under `set -e`
# would end the run at exactly the moment there is nothing wrong.
SEEDED="$(printf '%s' "${ALL_MISSING}" | grep -c '^demo/' || true)"
MISSING="$(printf '%s' "${ALL_MISSING}" | grep -v '^demo/' || true)"

if [ "${SEEDED}" -gt 0 ]; then
  echo "    (${SEEDED} sample row(s) under demo/ skipped — the seeder never"
  echo "     wrote a file for them, and they are not a fault)"
fi

if [ -z "${MISSING}" ]; then
  echo "    none"
else
  echo "${MISSING}" | sed 's/^/    /'
  echo
  echo "    These are not swept. Nothing here can recreate them — restore the" >&2
  echo "    uploads from Drive before doing anything else." >&2
  exit 1
fi
