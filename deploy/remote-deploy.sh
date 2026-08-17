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
#     GHCR_USER=<you> GHCR_TOKEN=<token> ./deploy/remote-deploy.sh
#
# The pull is deliberately NOT in here. `git reset --hard` replaces this very
# file, and bash reads a script as it goes — replacing it mid-run is how you
# get a shell executing half of one version and half of another. The caller
# pulls, then runs the version it pulled.
set -euo pipefail

cd "$(dirname "$0")"

if [ -z "${GHCR_USER:-}" ] || [ -z "${GHCR_TOKEN:-}" ]; then
  echo "GHCR_USER and GHCR_TOKEN must be set — they are what pulls the images." >&2
  exit 1
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

# --------------------------------------------------------------------------
# Swap the images.
# --------------------------------------------------------------------------
# `up -d` without --build is what keeps this one-vCPU box from ever compiling
# anything; the images were built on GitHub's runners.
docker compose pull --quiet api web
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
docker compose exec -T nginx nginx -s reload

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
marker=$(grep -o 'zone=sfm_login[^ ;]*' nginx/conf.d/sfm.conf | head -1)
if [ -z "$marker" ]; then
  echo "Could not find the marker in the repo's nginx config." >&2
  exit 1
fi
if ! docker compose exec -T nginx nginx -T 2>/dev/null | grep -q "$marker"; then
  echo "nginx is NOT running the config that is in git." >&2
  echo "Looked for '${marker}' in the live configuration and did not find it." >&2
  exit 1
fi
echo "nginx is running the config from git (found ${marker})."

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
