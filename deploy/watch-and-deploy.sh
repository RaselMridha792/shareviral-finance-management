#!/usr/bin/env bash
#
# The server deploys itself.
#
# GitHub builds the images and pushes them; this notices and pulls. Nothing
# reaches into the box from outside, which is the whole point — the pipeline
# spent four separate evenings failing on `dial tcp ***:22: i/o timeout`, and
# retries with backoff did not help because whatever was refusing the runner
# refused it for minutes at a time rather than seconds. A deploy that depends
# on an inbound connection is a deploy that depends on something nobody in this
# repository controls.
#
# Install (once, on the VPS):
#
#     sudo cp deploy/sfm-deploy.service deploy/sfm-deploy.timer /etc/systemd/system/
#     sudo systemctl daemon-reload
#     sudo systemctl enable --now sfm-deploy.timer
#
# It needs GHCR_USER and GHCR_TOKEN in deploy/.env — a GitHub personal access
# token with `read:packages` and nothing else. The images are in a private
# registry, so without them this can only restart what is already on the box.
#
# Watch it:
#     journalctl -u sfm-deploy.service -f
#     tail -f /opt/sfm/deploy/deploy.log

set -uo pipefail

cd "$(dirname "$0")"
REPO_ROOT="$(cd .. && pwd)"
LOG="$PWD/deploy.log"

say() {
  printf '[%s] %s\n' "$(TZ=Asia/Dhaka date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"
}

# --------------------------------------------------------------------------
# One at a time.
# --------------------------------------------------------------------------
# The timer fires every minute and a deploy takes several, so without this a
# second run would `git reset --hard` under the first one's feet — which is
# precisely the half-of-one-version-and-half-of-another failure the deploy
# script's own header warns about.
exec 9>"$PWD/.deploy.lock"
if ! flock -n 9; then
  exit 0
fi

# --------------------------------------------------------------------------
# Has anything landed?
# --------------------------------------------------------------------------
git -C "$REPO_ROOT" fetch --quiet origin main || {
  say "could not reach GitHub; will try again next minute"
  exit 0
}

REMOTE="$(git -C "$REPO_ROOT" rev-parse origin/main)"

# What is *running*, not what git says.
#
# This compared `git rev-parse HEAD` against origin/main, and that was wrong in
# a way that showed up immediately: somebody applying a SQL migration by hand
# runs `git reset --hard origin/main` first, which moves HEAD to the newest
# commit while the containers keep serving the old image. The watcher then saw
# HEAD == origin/main, concluded there was nothing to do, and never deployed —
# silently, which is the worst way to be wrong.
#
# A working tree can be moved by anybody with a shell. What has actually been
# deployed is a fact this script owns, so it writes it down.
STATE="$PWD/.deployed"
DEPLOYED="$(cat "$STATE" 2>/dev/null || true)"

if [ "$DEPLOYED" = "$REMOTE" ]; then
  exit 0
fi

# --------------------------------------------------------------------------
# Is the image for that commit actually built?
# --------------------------------------------------------------------------
# This is the race the whole design turns on. A commit lands on main the moment
# it is pushed; its images appear five minutes later, when CI finishes. Pulling
# on the commit alone would deploy the *previous* image against the new code —
# green, silent, and wrong.
#
# So the commit is not the signal. The image tagged with that commit is.
set -a
# shellcheck disable=SC1091
[ -f ./.env ] && . ./.env
set +a

IMAGE_API="${IMAGE_API:-ghcr.io/raselmridha792/sfm-api}"

if [ -z "${GHCR_USER:-}" ] || [ -z "${GHCR_TOKEN:-}" ]; then
  say "new commit ${REMOTE:0:7}, but no GHCR credentials — cannot check or pull"
  say "add GHCR_USER and GHCR_TOKEN to deploy/.env"
  exit 1
fi

echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 || {
  say "could not sign in to ghcr.io"
  exit 1
}

if ! docker manifest inspect "$IMAGE_API:$REMOTE" >/dev/null 2>&1; then
  # Not an error. CI is still building, and the next minute will ask again.
  #
  # But say so once, because silence here is indistinguishable from a broken
  # watcher — and today that cost an hour of looking in the wrong places while
  # the log said nothing at all. Once per commit rather than once a minute: a
  # line every sixty seconds is a log nobody reads, and the useful fact is
  # "this is what it is waiting for", which does not change until CI finishes
  # or somebody pushes again.
  WAITING="$PWD/.waiting"
  if [ "$(cat "$WAITING" 2>/dev/null || true)" != "$REMOTE" ]; then
    printf '%s' "$REMOTE" > "$WAITING"
    say "waiting for CI to publish the image for ${REMOTE:0:7}"
  fi
  exit 0
fi

# --------------------------------------------------------------------------
# Deploy.
# --------------------------------------------------------------------------
say "deploying ${REMOTE:0:7} (running ${DEPLOYED:0:7}${DEPLOYED:+; }${DEPLOYED:-nothing recorded})"

git -C "$REPO_ROOT" reset --hard --quiet "$REMOTE" || {
  say "could not check out $REMOTE"
  exit 1
}

# By digest-pinned tag rather than :latest. Two pushes minutes apart would
# otherwise race over which one :latest means by the time compose reads it.
export IMAGE_TAG="$REMOTE"

if bash ./remote-deploy.sh >>"$LOG" 2>&1; then
  # Written only after the deploy actually succeeded, so a failure is retried
  # next minute rather than recorded as done.
  printf '%s' "$REMOTE" > "$STATE"
  say "deployed ${REMOTE:0:7}"
else
  # Loud, and it does not roll back. A half-applied deploy that reverts itself
  # is harder to diagnose than one that stops and says where it stopped.
  say "DEPLOY FAILED at ${REMOTE:0:7} — the stack may be part-updated"
  say "see $LOG, and journalctl -u sfm-deploy.service"
  exit 1
fi
