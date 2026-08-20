#!/usr/bin/env bash
#
# What the server does to take a new release.
#
# This lived inside .github/workflows/deploy.yml as a hundred lines of YAML,
# which meant it could only ever be run by GitHub. On the night nginx would not
# start, GitHub could not reach the box at all, and recovery was four commands
# typed by hand at four in the morning — with the real steps sitting in a file
# nobody could run.
#
# It is a script now. The pipeline calls it, and so can a person:
#
#     cd /opt/sfm
#     git fetch origin main && git reset --hard origin/main
#     ./deploy/remote-deploy.sh
#
# With no arguments it brings the stack up on the images already on the box,
# which is the four-in-the-morning case. To fetch a new release as well, give it
# the registry credentials the pipeline uses:
#
#     GHCR_USER=<github-username> GHCR_TOKEN=<token> ./deploy/remote-deploy.sh
#
# The pull is deliberately NOT in here. `git reset --hard` replaces this very
# file, and bash reads a script as it goes — replacing it mid-run is how you
# get a shell executing half of one version and half of another. The caller
# pulls, then runs the version it pulled.
set -euo pipefail

cd "$(dirname "$0")"

# --------------------------------------------------------------------------
# Credentials are optional, and that is the point.
# --------------------------------------------------------------------------
# Without them this skips the registry entirely and brings the stack up on the
# images already on the box. That is the case that actually happens at four in
# the morning: the code is already here, nginx will not start, and somebody
# needs the thing running again — not a new release.
#
# Demanding a token for that turned recovery into a hunt for a token. The
# pipeline always passes them, so a real deploy still fetches what it built.
PULL=1
if [ -z "${GHCR_USER:-}" ] || [ -z "${GHCR_TOKEN:-}" ]; then
  PULL=0
  echo "No registry credentials given — restarting on the images already here."
  echo "(Set GHCR_USER and GHCR_TOKEN to fetch a new release.)"
fi

# --------------------------------------------------------------------------
# Sign in, for the length of this pull only.
# --------------------------------------------------------------------------
# A GITHUB_TOKEN dies when its job ends, so even a copy of it is worthless a
# minute from now — which is not true of a personal access token, and the
# reason not to use one.
#
# Three attempts, because one is not enough. GHCR once answered `denied: denied`
# to a login that had worked on every deploy before it and worked again on a
# re-run a minute later, with nothing about the credentials changed. A deploy
# that fails on somebody else's momentary refusal teaches people that a red run
# means nothing — which is expensive on the run where it means something.
if [ "$PULL" = "1" ]; then
for attempt in 1 2 3; do
  if echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin; then
    break
  fi
  if [ "$attempt" = "3" ]; then
    echo "Could not sign in to ghcr.io after three attempts." >&2
    exit 1
  fi
  echo "ghcr.io login failed, attempt ${attempt}. Retrying." >&2
  sleep $((attempt * 5))
done
# Signed out even if everything below fails.
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi

# --------------------------------------------------------------------------
# Swap the images.
# --------------------------------------------------------------------------
# `up -d` without --build is what keeps this one-vCPU box from ever compiling
# anything; the images were built on GitHub's runners.
if [ "$PULL" = "1" ]; then
  docker compose pull --quiet api web
fi

# --------------------------------------------------------------------------
# The schema, before the code that expects it.
# --------------------------------------------------------------------------
# This step exists because of an outage it would have prevented. A release
# added two columns and a table; the SQL was written, committed, and applied to
# the developer's database — and the deploy carried the code to a server whose
# database had never seen it. Drizzle names every column in its SELECT, so the
# first query against `app_settings` failed, and with it every page that reads
# settings. The site was down until somebody typed the migration by hand.
#
# Applying them here is safe because of how they are written: every file in
# `deploy/sql` uses IF NOT EXISTS, so running all of them on every deploy is
# the same as running the new ones. That is the property that makes "just run
# them all, every time" better than any list of what has already been applied —
# there is no list to get wrong.
#
# Before `up -d`, not after. Between the two is the window where the new code
# is serving against the old schema, and the whole point is that the window
# should not exist.
if [ -d ./sql ]; then
  # The database has to be up to be migrated, and on the first deploy of a box
  # it is not. Bringing it up alone is harmless when it already is. The profile
  # is named because the service carries one; the `|| true` covers the
  # installation that points DATABASE_URL at a managed database instead and has
  # no `db` service at all.
  COMPOSE_PROFILES=local-db docker compose up -d db >/dev/null 2>&1 || true

  db_container="$(docker ps --format '{{.Names}}' | grep -m1 -- '-db-' || true)"

  if [ -n "$db_container" ]; then
    # The credentials come from inside the container, not from this shell.
    #
    # `.env` is read by docker compose, not by bash, so POSTGRES_USER is not a
    # variable here — and this script runs under `set -u`, where naming one
    # that does not exist aborts the deploy. The database container already has
    # both in its environment, so `sh -c` inside it is both simpler and the
    # only version that cannot be wrong about which database this is.
    psql_in_db() {
      docker exec -i "$db_container"         sh -c 'psql -v ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    }

    # `pg_isready`, because a container that has just been created answers
    # `docker exec` seconds before Postgres answers a connection.
    for _ in $(seq 1 30); do
      if docker exec "$db_container"         sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done

    # A one-line query, for asking the database about itself.
    psql_query() {
      docker exec -i "$db_container"         sh -c 'psql -tAq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<<"$1"
    }

    # --------------------------------------------------------------------
    # Once each, recorded — not all of them, every time.
    # --------------------------------------------------------------------
    # The first version of this ran every file on every deploy, on the
    # reasoning that `IF NOT EXISTS` makes re-running harmless. That is true
    # of a file taken alone and false of this directory taken together: three
    # separate files drop and recreate the `files_one_owner` constraint, each
    # counting one more owner column than the last. Run in filename order,
    # the August 20th definition lands on top of the August 21st one, and the
    # row that only the newer rule allows then fails the older one. The deploy
    # stopped, correctly, and stayed stopped every minute after.
    #
    # Idempotent is not the same as order-independent. So the database
    # remembers which files it has seen, and each runs once.
    psql_query "create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    );" >/dev/null

    # An existing database is already at whatever hand-applied SQL made it,
    # and replaying its history is precisely the hazard above. So the first
    # time this ledger appears on a database that already has tables, it is
    # filled in rather than acted on — and says so, loudly, because a step
    # that silently decides to do nothing is worse than one that fails.
    baseline=0
    if [ "$(psql_query "select count(*) from schema_migrations")" = "0" ] &&
       [ "$(psql_query "select count(*) from information_schema.tables
                         where table_schema = 'public' and table_name = 'files'")" = "1" ]; then
      baseline=1
      echo "schema: existing database — recording the current files as already applied"
    fi

    ran=0
    for file in ./sql/*.sql; do
      [ -e "$file" ] || continue
      name="$(basename "$file")"

      if [ "$(psql_query "select 1 from schema_migrations
                           where filename = '$name'")" = "1" ]; then
        continue
      fi

      if [ "$baseline" = "0" ]; then
        # ON_ERROR_STOP, so a broken migration stops the deploy rather than
        # printing into a log and letting the release go out anyway.
        if ! psql_in_db < "$file" >/dev/null; then
          echo "migration failed: $file" >&2
          echo "the stack has NOT been updated; fix the migration and deploy again" >&2
          exit 1
        fi
        ran=$((ran + 1))
      fi

      psql_query "insert into schema_migrations (filename) values ('$name')
                  on conflict do nothing" >/dev/null
    done

    if [ "$baseline" = "1" ]; then
      echo "schema: baseline recorded; nothing was run"
    else
      echo "schema: $ran new migration file(s) applied"
    fi
  else
    # No local database service. Nothing here knows how to reach a managed one
    # safely, and guessing would be worse than saying so.
    echo "schema: no db container found — apply deploy/sql by hand" >&2
  fi
fi

docker compose up -d --remove-orphans

# --------------------------------------------------------------------------
# Wait until nginx can be entered before entering it.
# --------------------------------------------------------------------------
# `up -d` returns when Docker reports the container Started, which is not the
# same as ready to exec into. When the container has just been recreated — what
# happens the first time a volume definition changes — the old one is still
# being torn down, and an exec issued in that window resolves to a process that
# is already gone:
#
#   OCI runtime exec failed: unable to create new parent process:
#   namespace path: lstat /proc/571318/ns/ipc: no such file
#
# Polling with a trivial command separates "not up yet", which is worth waiting
# for, from "the configuration is bad", which is worth failing on. Those two
# must not be retried the same way.
for attempt in $(seq 1 20); do
  if docker compose exec -T nginx true >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = "20" ]; then
    echo "nginx never became ready to accept a command." >&2
    docker compose logs --tail 40 nginx >&2 || true
    exit 1
  fi
  sleep 2
done

# --------------------------------------------------------------------------
# Re-read the configuration.
# --------------------------------------------------------------------------
# It comes from a bind-mounted directory, and `up -d` does not restart nginx
# when only the config changed — so it has to be told.
#
# Tested first, reloaded second, and in that order on purpose. If the new file
# is bad, `nginx -t` fails, `set -e` stops here, and the old configuration keeps
# serving the site — far better than a reload that takes nginx down.
docker compose exec -T nginx nginx -t

# Note the time before reloading, so the log can be read from here forward and
# an old error is not mistaken for a new one.
reload_from=$(date -u +%Y-%m-%dT%H:%M:%S)
docker compose exec -T nginx nginx -s reload

# --------------------------------------------------------------------------
# Did the master actually ACCEPT it?
# --------------------------------------------------------------------------
# `nginx -t` cannot answer this and neither can `nginx -T`. Both parse the
# files from disk in a fresh process; neither asks the running master what it
# is serving. `nginx -s reload` only sends a signal, and returns success for
# having sent it.
#
# So the master can read the new configuration, refuse it, log why, and carry
# on serving the old one - with the site up, every command exiting zero, and
# the deploy green. That is exactly what happened on 18 Aug: a limit_req zone
# whose key changed while its name stayed the same is rejected, because the
# shared memory zone survives a reload and nginx will only reuse one whose key
# still matches.
#
#   [emerg] limit_req "sfm_login" uses the "$login_limit_key" key
#           while previously it used the "$binary_remote_addr" key
#
# It logged that four times across four deploys and nothing ever went red.
sleep 2
if docker compose logs --since "$reload_from" nginx 2>&1 | grep -E '\[emerg\]|\[alert\]'; then
  echo "" >&2
  echo "nginx REFUSED the new configuration and is still serving the old one." >&2
  echo "The lines above are from the reload that just happened." >&2
  exit 1
fi

# --------------------------------------------------------------------------
# And then prove it, because "nginx -t passed" once proved nothing.
# --------------------------------------------------------------------------
# The config used to be bind-mounted as a single FILE. `git reset --hard`
# replaces a file rather than editing it, which makes a new inode, and a
# single-file bind mount follows the inode — so the container kept reading the
# config it booted with. `nginx -t` validated that stale file and passed. The
# reload reloaded it and succeeded. The deploy went green. Rate limits added on
# 18 Aug did nothing at all for an hour, and every signal said fine.
#
# `nginx -T` dumps the configuration nginx is ACTUALLY running. Comparing a
# marker from the repo against that dump is the one check that would have caught
# it. A silent no-op deploy is worse than a failed one: a red run gets fixed, a
# green one gets trusted.
# The whole file, compared byte for byte - not a marker.
#
# This used to grep the live dump for `zone=sfm_login:10m`, which was in the
# repository's config and also in every older version of it. So the check
# passed against a config from three deploys ago and reported success. A
# verification that cannot fail is not a verification, and this one had already
# been shipped as the fix for exactly this problem.
#
# `nginx -T` prints each file after a `# configuration file <path>:` header, so
# the block can be pulled out and diffed against what git has. Anything that
# differs - stale mount, half-written file, an edit made on the box and
# forgotten - is a difference, and there is nothing left to be clever about.
live=$(mktemp)
if ! docker compose exec -T nginx nginx -T 2>/dev/null   | awk '/^# configuration file .*\/conf\.d\/sfm\.conf:$/{on=1;next} /^# configuration file /{on=0} on'   > "$live"; then
  echo "Could not read the live nginx configuration." >&2
  rm -f "$live"
  exit 1
fi

if [ ! -s "$live" ]; then
  echo "nginx is not serving conf.d/sfm.conf at all." >&2
  rm -f "$live"
  exit 1
fi

# Whitespace only. `nginx -T` pads each dumped file with a blank line, so
# without -B this check fails on every single deploy - which is a gate that
# cries wolf, and a gate that cries wolf gets ignored on the day it is right.
if ! diff -qB <(sed -e 's/[[:space:]]*$//' nginx/conf.d/sfm.conf) <(sed -e 's/[[:space:]]*$//' "$live") >/dev/null; then
  echo "nginx is NOT running the config that is in git." >&2
  echo "--- what differs (git on the left, live on the right) ---" >&2
  diff -B <(sed -e 's/[[:space:]]*$//' nginx/conf.d/sfm.conf) <(sed -e 's/[[:space:]]*$//' "$live") | head -40 >&2
  rm -f "$live"
  exit 1
fi
rm -f "$live"
echo "nginx is running exactly the config that is in git."

# --------------------------------------------------------------------------
# And prove the site answers, which is the only thing anybody actually wants.
# --------------------------------------------------------------------------
# Through nginx, from inside the network — so this is about the stack rather
# than about DNS or the certificate. A deploy that finishes with every container
# "Started" and a site that 502s is the failure this catches.
for attempt in $(seq 1 15); do
  if docker compose exec -T nginx wget -q -O /dev/null --header 'Host: app.hellonizam.com' http://127.0.0.1/login 2>/dev/null; then
    echo "the app answered through nginx."
    break
  fi
  if [ "$attempt" = "15" ]; then
    echo "nginx is up and configured, but the app never answered through it." >&2
    docker compose ps >&2
    docker compose logs --tail 30 web >&2 || true
    exit 1
  fi
  sleep 2
done

# Images pile up fast on 50 GB. Keep the current ones, drop the rest — dangling
# only, so a tagged rollback target survives.
docker image prune -f

docker compose ps
