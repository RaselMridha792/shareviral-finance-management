#!/usr/bin/env bash
#
# One command, for the questions that got asked ten times in one afternoon.
#
#     cd /opt/sfm && ./deploy/status.sh
#
# Reads only. Nothing here starts, stops, deletes or deploys anything, so it is
# safe to run at any moment — including in the middle of a deploy, which is
# usually exactly when somebody wants it.
#
# It exists because diagnosing this stack meant six round trips: which commit is
# live, is the watcher alive, what did it last say, are the containers up, is
# the disk full, does the database still answer. Each of those is one line of
# shell and together they are the whole picture.

# No `-e`. A status report that stops at the first thing it cannot read is
# worse than useless — the section that fails is often the one being asked
# about.
set -uo pipefail

cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --------------------------------------------------------------------------
say "What is running"
# --------------------------------------------------------------------------
LIVE="$(curl -fsS --max-time 10 https://api.hellonizam.com/api/health 2>/dev/null \
  | grep -oE '[0-9a-f]{40}' | head -1)"
DEPLOYED="$(cat ./.deployed 2>/dev/null)"
WAITING="$(cat ./.waiting 2>/dev/null)"

git -C .. fetch --quiet origin main 2>/dev/null
REMOTE="$(git -C .. rev-parse origin/main 2>/dev/null)"

printf '  live api        %s\n' "${LIVE:-unreachable}"
printf '  last deployed   %s\n' "${DEPLOYED:-nothing recorded}"
printf '  origin/main     %s\n' "${REMOTE:-unknown}"

if [ -n "$LIVE" ] && [ "$LIVE" = "$REMOTE" ]; then
  printf '  -> up to date\n'
elif [ -n "$REMOTE" ]; then
  # The number that answers "is it stuck, or is it working".
  BEHIND="$(git -C .. rev-list --count "${LIVE:-$DEPLOYED}..$REMOTE" 2>/dev/null)"
  printf '  -> %s commit(s) behind\n' "${BEHIND:-?}"
  [ -n "$WAITING" ] && printf '  -> watcher is waiting for the image for %s\n' "${WAITING:0:7}"
fi

# --------------------------------------------------------------------------
say "The deploy watcher"
# --------------------------------------------------------------------------
# `active (waiting)` with a real Trigger time is healthy. `Trigger: n/a` means
# nothing is scheduled, which is the failure that looks like health.
systemctl show sfm-deploy.timer \
  --property=ActiveState,NextElapseUSecRealtime --no-pager 2>/dev/null \
  | sed 's/^/  /'
systemctl show sfm-deploy.service \
  --property=ActiveState,Result,ExecMainStatus --no-pager 2>/dev/null \
  | sed 's/^/  /'

say "The last thing the deploy said"
tail -n 12 ./deploy.log 2>/dev/null | sed 's/^/  /' || echo "  (no deploy.log yet)"

# --------------------------------------------------------------------------
say "Containers"
# --------------------------------------------------------------------------
docker compose ps --format '  {{.Name}}\t{{.Status}}' 2>/dev/null \
  || echo "  (docker compose did not answer)"

# --------------------------------------------------------------------------
say "Disk"
# --------------------------------------------------------------------------
# Uploads and Postgres share this filesystem, and a full disk stops both in
# ways that read as unrelated bugs.
df -h / | tail -1 | awk '{printf "  root %s used of %s (%s)\n", $3, $2, $5}'
du -sh /data/uploads 2>/dev/null | awk '{printf "  uploads %s\n", $1}'
du -sh ./backups 2>/dev/null | awk '{printf "  backups %s\n", $1}'

# --------------------------------------------------------------------------
say "Database"
# --------------------------------------------------------------------------
# Credentials from inside the container: `.env` is read by docker compose, not
# by this shell, and sourcing it here would drag every secret into scope for a
# report that needs none of them.
DB="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 -- '-db-')"
if [ -z "$DB" ]; then
  echo "  no database container found"
else
  docker exec -i "$DB" sh -c 'psql -tAq -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' 2>/dev/null | sed 's/^/  /'
select 'sign-ins      ' || count(*) from users where deleted_at is null
union all select 'transactions  ' || count(*) from transactions where deleted_at is null
union all select 'team members  ' || count(*) from team_members where deleted_at is null
union all select 'migrations    ' || count(*) from schema_migrations
union all select 'unread bells  ' || count(*) from notifications where read_at is null;
SQL
  [ "${PIPESTATUS[0]}" != "0" ] && echo "  (the database did not answer)"
fi

echo
